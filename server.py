# -*- coding: utf-8 -*-
import io
import json
import base64
import numpy as np
from PIL import Image, ImageEnhance
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import cv2
import difflib
import logging
import re
import threading
import gc

# ==========================================
# [설정]
# ==========================================
# 사용할 로컬 LLM 모델 (터미널에서 'ollama pull gemma2' 필요)
OLLAMA_MODEL = "gemma2" 
SERVER_PORT = 5000
# ==========================================

app = Flask(__name__)
CORS(app)
processing_lock = threading.Lock()

print("\n" + "="*60)
print(f"   🚀 AI 서버 v41.0 (Subject-Topic Merged) 🚀")
print(f"   ▶ 기능: 과목과 주제를 하나로 통합하여 분석")
print("="*60 + "\n")

# EasyOCR 초기화
try:
    import easyocr
    reader = easyocr.Reader(['ko', 'en'], gpu=True) 
    print("✅ EasyOCR 준비 완료! (GPU)")
except:
    print("⚠️ GPU 실패 -> CPU 모드")
    reader = easyocr.Reader(['ko', 'en'], gpu=False)

def cv2_to_base64(image_cv):
    if image_cv is None or image_cv.size == 0: return None
    try:
        _, buffer = cv2.imencode('.jpg', image_cv)
        return base64.b64encode(buffer).decode('utf-8')
    except: return None

def enhance_handwriting(image_cv):
    try:
        lab = cv2.cvtColor(image_cv, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8,8))
        cl = clahe.apply(l)
        return cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)
    except: return image_cv

def safe_crop(img, x, y, w, h):
    if img is None: return None
    H, W = img.shape[:2]
    x = int(max(0, min(x, W-1)))
    y = int(max(0, min(y, H-1)))
    w = int(max(1, min(w, W-x)))
    h = int(max(1, min(h, H-y)))
    crop = img[y:y+h, x:x+w]
    return crop if crop.size > 0 else None

# ---------------------------------------------------------
# [핵심] 이름 영역 단순화 (우측 상단 강제 크롭)
# ---------------------------------------------------------
def extract_rois(image_cv, ocr_results, roster):
    H, W, _ = image_cv.shape
    
    # 1. 이름 영역: 사용자 요청대로 "상단 20%, 우측 부분"을 무조건 자름
    # (복잡한 라벨 찾기 로직 제거 -> 속도 향상 및 오인식 방지)
    
    # 우측 60% 영역 (중앙보다 약간 왼쪽부터 끝까지)
    crop_x = int(W * 0.4) 
    crop_y = 0
    crop_w = int(W * 0.6)
    crop_h = int(H * 0.25) # 상단 25% (여유있게)
    
    crop_name = safe_crop(image_cv, crop_x, crop_y, crop_w, crop_h)
    matched_name = ""

    # 잘라낸 영역(우측 상단)에서 이름 텍스트 찾기
    if crop_name is not None:
        enhanced = enhance_handwriting(crop_name)
        sub_res = reader.readtext(enhanced, detail=0)
        
        # 1. 명단 매칭 (최우선)
        for word in sub_res:
            if roster:
                matches = difflib.get_close_matches(word, roster, n=1, cutoff=0.5)
                if matches: matched_name = matches[0]; break
        
        # 2. 명단에 없으면 패턴 매칭 (2~4글자 한글)
        if not matched_name:
            hangul = re.compile('[^가-힣]+')
            for word in sub_res:
                clean_w = hangul.sub('', word)
                # 금지어 목록 (라벨 등)
                forbidden = ["이름","성명","확인","점수","학년","평가","단원","과목","초등","학교","반","번","담임"]
                if 2 <= len(clean_w) <= 4 and clean_w not in forbidden:
                    matched_name = clean_w
                    break

    # 2. 성적 영역 찾기 (키워드 좌표 기반 유지)
    high_keywords = ["매우", "잘함"]
    low_keywords = ["보통", "노력", "요함"]
    high_ys = []; low_ys = []
    
    for (bbox, text, _) in ocr_results:
        clean = text.replace(" ", "")
        if any(k in clean for k in high_keywords): 
            high_ys.extend([bbox[0][1], bbox[2][1]])
        elif any(k in clean for k in low_keywords): 
            low_ys.extend([bbox[0][1], bbox[2][1]])
            
    def get_crop_y(ys, f_start, f_end):
        if not ys: return safe_crop(image_cv, 0, int(f_start), W, int(f_end - f_start))
        y_min = min(ys); y_max = max(ys)
        return safe_crop(image_cv, 0, int(y_min - 40), W, int(y_max - y_min + 100))

    crop_high = get_crop_y(high_ys, H*0.3, H*0.55)
    crop_low = get_crop_y(low_ys, H*0.55, H*0.8)
    
    return matched_name, cv2_to_base64(crop_name), cv2_to_base64(crop_high), cv2_to_base64(crop_low)

def detect_red_score(image_cv, ocr_results):
    try:
        hsv = cv2.cvtColor(image_cv, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, (0, 60, 60), (10, 255, 255)) + cv2.inRange(hsv, (170, 60, 60), (180, 255, 255))
        mask = cv2.dilate(mask, np.ones((3,3), np.uint8), iterations=1)
        best = ""; max_p = 0
        grades = ["매우잘함", "잘함", "보통", "노력요함"]
        for (bbox, text, _) in ocr_results:
            clean = text.replace(" ", "")
            matched = next((g for g in grades if g in clean), None)
            if matched:
                xs = [int(p[0]) for p in bbox]; ys = [int(p[1]) for p in bbox]
                pad = 30
                roi = safe_crop(mask, min(xs)-pad, min(ys)-pad, (max(xs)-min(xs))+pad*2, (max(ys)-min(ys))+pad*2)
                if roi is not None:
                    reds = cv2.countNonZero(roi)
                    if reds > 40 and reds > max_p:
                        max_p = reds
                        if "매우" in matched: best = "매우 잘함"
                        elif "노력" in matched: best = "노력 요함"
                        elif "보통" in matched: best = "보통"
                        else: best = "잘함"
        return best
    except: return ""

def analyze_with_ollama(text, roster, vision_score, f_subj, f_topic):
    roster_hint = f"{', '.join(roster)}" if roster else "없음"
    
    # [수정] 과목과 주제를 'subject_topic' 하나로 통합
    fixed_st = ""
    if f_subj or f_topic:
        # 하나라도 고정값이 있으면 병합
        s = f_subj if f_subj else ""
        t = f_topic if f_topic else ""
        fixed_st = f"{s}-{t}" if s and t else (s + t)

    st_rule = f"2. subject_topic: '{fixed_st}' (고정)." if fixed_st else "2. subject_topic: 과목과 주제를 하나로 합쳐서 작성 (예: '수학-분수의 덧셈', '국어-읽기')."

    prompt = f"""
    초등학교 수행평가 분석. JSON 출력.
    [OCR] {text[:2000]}
    [규칙]
    1. name: 학생이름 (힌트: {roster_hint})
    {st_rule}
    3. rawScore: {f"'{vision_score}' 마킹 감지됨." if vision_score else "점수/등급."}
    Output JSON: {{ "name": "", "subject_topic": "", "rawScore": "" }}
    """
    try:
        res = requests.post('http://localhost:11434/api/generate', json={
            "model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "format": "json", "options": {"temperature": 0}
        }, timeout=30)
        if res.status_code == 200: return json.loads(res.json()['response'])
    except: pass
    return None

@app.route('/health', methods=['GET'])
def health_check(): return jsonify({"status": "ok", "engine": "v41.0_MERGED_ST"})

@app.route('/analyze', methods=['POST'])
def analyze_image():
    with processing_lock:
        if 'file' not in request.files: return jsonify({"error": "No file"}), 400
        file = request.files['file']
        roster = json.loads(request.form.get('roster', '[]'))
        f_sub = request.form.get('fixed_subject', '')
        f_top = request.form.get('fixed_topic', '')
        
        print(f"▶ 분석: {file.filename}")
        try:
            img_bytes = file.read()
            if len(img_bytes) == 0: raise ValueError("빈 파일")
            pil_img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
            np_img = np.array(pil_img)
            image_cv = cv2.cvtColor(np_img, cv2.COLOR_RGB2BGR)
            
            enhanced = enhance_handwriting(image_cv)
            raw_results = reader.readtext(enhanced, detail=1)
            full_text = " ".join([r[1] for r in raw_results])
            
            matched_name, crop_name, crop_high, crop_low = extract_rois(image_cv, raw_results, roster)
            vision_score = detect_red_score(image_cv, raw_results)
            llm_res = analyze_with_ollama(full_text, roster, vision_score, f_sub, f_top)
            
            final_name = matched_name if matched_name else (llm_res.get('name','') if llm_res else '')
            
            if roster and final_name:
                 matches = difflib.get_close_matches(final_name, roster, n=1, cutoff=0.5)
                 final_name = matches[0] if matches else ""

            # [수정] 결과 병합 로직 (subject + topic -> subject)
            fixed_st = ""
            if f_sub or f_top:
                s = f_sub if f_sub else ""
                t = f_top if f_top else ""
                fixed_st = f"{s}-{t}" if s and t else (s + t)
            
            final_st = fixed_st if fixed_st else (llm_res.get('subject_topic', '기타-수행평가') if llm_res else '기타-수행평가')
            final_score = vision_score if vision_score else (llm_res.get('rawScore','') if llm_res else '')
            
            gc.collect()
            
            # 웹앱 호환성을 위해 'subject'에 통합된 값을 넣고, 'topic'은 비워둠
            return jsonify({
                "name": final_name, 
                "subject": final_st, 
                "topic": "", 
                "rawScore": final_score, 
                "raw_text": full_text,
                "crop_name": crop_name, "crop_high": crop_high, "crop_low": crop_low
            })
        except Exception as e:
            print(f"!!! 오류: {e}")
            return jsonify({"name":"", "subject":"오류", "topic":"", "rawScore":"", "raw_text":str(e)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=SERVER_PORT, threaded=True)