import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Upload, FileSpreadsheet, Trash2, Save, Loader2, AlertCircle, Eye, X, Settings, Table, List, ChevronRight, PenTool, CheckSquare, Square, Search, Users, ClipboardList, AlertTriangle, Server, Zap, Keyboard } from 'lucide-react';

// --- 외부 라이브러리 로드 (CDN) ---
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
};

// --- 상수 ---
const GRADES = ["매우 잘함", "잘함", "보통", "노력 요함"];
// 과목-주제 통합으로 인해 정렬 순서는 가나다순을 기본으로 하되, 주요 과목 우선
const SUBJECT_PRIORITY = ['국어', '수학', '사회', '과학', '영어', '도덕', '미술', '음악', '체육', '실과'];

// --- 자동완성 입력 컴포넌트 ---
const AutocompleteInput = ({ value, onChange, roster, placeholder, onNext }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const wrapperRef = useRef(null);

    useEffect(() => {
        if (showSuggestions && value) {
            const cleanValue = value.trim();
            if (!cleanValue) {
                setSuggestions([]);
                return;
            }
            const filtered = roster.filter(name => name.includes(cleanValue));
            setSuggestions(filtered);
            setHighlightIndex(0);
        } else {
            setSuggestions([]);
        }
    }, [value, showSuggestions, roster]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (showSuggestions && suggestions.length > 0) {
                e.preventDefault();
                onChange(suggestions[highlightIndex]);
                setShowSuggestions(false);
                if(onNext) onNext();
            }
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    const handleClickOutside = (e) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
            setShowSuggestions(false);
        }
    };

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div ref={wrapperRef} className="relative w-full h-full">
            <input
                type="text"
                value={value || ''}
                onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
                className={`w-full h-full text-center bg-transparent outline-none font-bold text-slate-800 ${!value ? 'bg-red-50' : ''}`}
                placeholder={placeholder}
            />
            {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-50 w-full bg-white border border-slate-300 shadow-lg max-h-40 overflow-y-auto left-0 top-full rounded-md text-left">
                    {suggestions.map((name, idx) => (
                        <li
                            key={idx}
                            onClick={() => { onChange(name); setShowSuggestions(false); }}
                            className={`px-3 py-2 text-xs cursor-pointer ${idx === highlightIndex ? 'bg-indigo-100 text-indigo-900 font-bold' : 'hover:bg-slate-50'}`}
                        >
                            {name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// --- 에러 바운더리 ---
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, errorInfo) { console.error("Crash:", error, errorInfo); }
  render() {
    if (this.state.hasError) return <div className="flex h-screen items-center justify-center">일시적 오류가 발생했습니다. 새로고침 해주세요.</div>;
    return this.props.children;
  }
}

// --- 메인 컴포넌트 ---
const PrivacyGradeManager = () => {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [results, setResults] = useState([]); 
  
  const [focusedItem, setFocusedItem] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking'); 
  const [viewMode, setViewMode] = useState('list'); 
  
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkSubject, setBulkSubject] = useState(''); // 과목-주제 통합 입력용
  const [studentRoster, setStudentRoster] = useState([]);
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [rosterInput, setRosterInput] = useState('');
  const [scoreSettings, setScoreSettings] = useState({ veryGood: 90, good: 80, average: 60 });
  const [showSettings, setShowSettings] = useState(false);

  const activeItem = useMemo(() => {
    if (!focusedItem) return null;
    return results.find(r => r.id === focusedItem.id) || null;
  }, [results, focusedItem]);

  // 스타일 주입
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      html, body, #root { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      .grid-table { border-collapse: collapse; width: 100%; table-layout: fixed; background-color: white; }
      .grid-table th, .grid-table td { border: 1px solid #94a3b8; padding: 0; vertical-align: middle; height: 42px; }
      .grid-table th { background-color: #f1f5f9; font-weight: bold; text-align: center; color: #1e293b; padding: 8px; font-size: 13px; }
      .grid-table input { width: 100%; height: 100%; border: none; background: transparent; outline: none; text-align: center; font-size: 14px; padding: 0 4px; font-weight: 500; color: #334155; }
      .grid-table select { width: 100%; height: 100%; border: none; background: transparent; outline: none; cursor: pointer; text-align: center; text-align-last: center; font-size: 13px; font-weight: 600; color: #334155; }
      .grid-table input:focus, .grid-table select:focus { background-color: #e0e7ff; }
      .grid-table tr:hover { background-color: #f8fafc; }
      .selected-row { background-color: #eff6ff !important; }
      .missing-data { background-color: #fef2f2; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // 라이브러리 로드
  useEffect(() => {
    const initEngine = async () => {
      try {
        await Promise.all([
          loadScript('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'),
          loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
        ]);
        if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      } catch (error) { console.error("라이브러리 로드 실패:", error); }
    };
    initEngine();
  }, []);

  // 서버 체크
  useEffect(() => {
      const check = async () => {
          try { (await fetch('http://localhost:5000/health')).ok ? setServerStatus('connected') : setServerStatus('disconnected'); } 
          catch { setServerStatus('disconnected'); }
      };
      check();
      const interval = setInterval(check, 5000); 
      return () => clearInterval(interval);
  }, []);

  const convertScoreToGrade = (rawInput) => {
    if (!rawInput) return "";
    if (GRADES.includes(rawInput)) return rawInput;
    const num = parseFloat(rawInput);
    if (!isNaN(num)) {
      if (num >= scoreSettings.veryGood) return "매우 잘함";
      if (num >= scoreSettings.good) return "잘함";
      if (num >= scoreSettings.average) return "보통";
      return "노력 요함";
    }
    return "";
  };

  const handleFileUpload = (e) => {
    const uploadedFiles = Array.from(e.target.files);
    if (files.length + uploadedFiles.length > 50) {
      alert("한 번에 최대 50개까지 가능합니다."); return;
    }
    setFiles((prev) => [...prev, ...uploadedFiles]);
  };

  const convertPdfToImages = async (file) => {
    const fileUrl = URL.createObjectURL(file);
    const pdf = await window.pdfjsLib.getDocument(fileUrl).promise;
    const images = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.5 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height; canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport: viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const res = await fetch(dataUrl);
      images.push(new File([await res.blob()], `${file.name}_p${i}.jpg`, { type: 'image/jpeg' }));
    }
    return images;
  };

  const processFiles = async () => {
    if (serverStatus !== 'connected') { alert("서버 연결이 필요합니다 (server.py 실행)"); return; }
    if (files.length === 0) return;
    
    setProcessing(true); setViewMode('list');
    const processed = new Set(results.map(r => r.parentFileName));
    const toProcess = files.filter(f => !processed.has(f.name));
    
    if (toProcess.length === 0) { setProcessing(false); alert('모두 처리되었습니다.'); return; }

    let allImages = [];
    let convertCount = 0;
    
    for (const file of toProcess) {
        setStatusMessage(`파일 변환 중... (${++convertCount}/${toProcess.length})`);
        try {
            if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                const imgs = await convertPdfToImages(file);
                allImages.push(...imgs.map(img => ({ fileObj: img, parentName: file.name })));
            } else {
                allImages.push({ fileObj: file, parentName: file.name });
            }
        } catch (e) { console.error(e); }
    }

    const CONCURRENCY = 3;
    let completed = 0;
    // 파일별 고정값 (과목-주제)
    const fileFixedInfo = {}; 

    const processImage = async (imgData) => {
        const { fileObj, parentName } = imgData;
        const formData = new FormData();
        formData.append('file', fileObj);
        if (studentRoster.length > 0) formData.append('roster', JSON.stringify(studentRoster));
        
        // 고정된 과목-주제가 있으면 전달 (서버 v41.0 대응: fixed_subject 하나만 씀)
        if (fileFixedInfo[parentName]) {
            formData.append('fixed_subject', fileFixedInfo[parentName]);
        }

        try {
            const response = await fetch('http://localhost:5000/analyze', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Server Error');
            const data = await response.json();

            // 첫 페이지에서 과목-주제(subject)가 나오면 고정
            // (서버 v41.0은 subject 필드에 "과목-주제"를 합쳐서 보냄)
            if (!fileFixedInfo[parentName] && data.subject && data.subject !== "기타-수행평가") {
                fileFixedInfo[parentName] = data.subject;
            }
            
            const resSubject = fileFixedInfo[parentName] || data.subject || "기타-수행평가";

            setResults(prev => [...prev, {
                id: Date.now() + Math.random(), parentFileName: parentName, fileObj,
                rawText: data.raw_text || "", studentName: data.name || "",
                subject: resSubject, // 이제 여기에 '과목-주제'가 통째로 들어감
                rawScore: data.rawScore || "", grade: convertScoreToGrade(data.rawScore) || data.rawScore,
                cropName: data.crop_name, 
                cropHigh: data.crop_high, 
                cropLow: data.crop_low
            }]);
        } catch (err) {
            setResults(prev => [...prev, {
                id: Date.now() + Math.random(), parentFileName: parentName, fileObj,
                rawText: "Error", studentName: "", subject: "분석실패", rawScore: "", grade: ""
            }]);
        } finally {
            completed++;
            setStatusMessage(`AI 분석 중... (${completed}/${allImages.length})`);
        }
    };

    for (let i = 0; i < allImages.length; i += CONCURRENCY) {
        const chunk = allImages.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(img => processImage(img)));
    }

    setProcessing(false); setStatusMessage("완료");
  };

  const updateResult = (id, f, v) => setResults(p => p.map(i => i.id===id ? {...i, [f]:v} : i));
  const deleteResult = (id) => setResults(p => p.filter(i => i.id !== id));
  const toggleSelect = (id) => {
      const s = new Set(selectedIds);
      s.has(id) ? s.delete(id) : s.add(id);
      setSelectedIds(s);
  };
  const toggleSelectAll = () => setSelectedIds(selectedIds.size === results.length ? new Set() : new Set(results.map(r => r.id)));
  
  const applyBulkEdit = () => {
      setResults(p => p.map(i => selectedIds.has(i.id) ? {...i, subject: bulkSubject||i.subject} : i));
      setBulkSubject(''); setSelectedIds(new Set());
      alert("수정되었습니다.");
  };

  const handleSaveRoster = () => {
      setStudentRoster([...new Set(rosterInput.split(/[\n,]+/).map(s=>s.trim()).filter(s=>s.length>=2))].sort());
      setShowRosterModal(false);
  };

  const duplicateIds = useMemo(() => {
      const counts = {}; const ids = new Set();
      results.forEach(r => {
          if (!r.studentName) return;
          // 중복 체크 키: 이름 + 과목-주제
          const key = `${r.studentName}-${r.subject}`;
          if (!counts[key]) counts[key] = []; counts[key].push(r.id);
      });
      Object.values(counts).forEach(group => { if (group.length > 1) group.forEach(id => ids.add(id)); });
      return ids;
  }, [results]);

  const matrixData = useMemo(() => {
      let students = studentRoster.length ? [...studentRoster] : [...new Set(results.map(r=>r.studentName).filter(n=>n))].sort();
      
      // 열 생성 (과목-주제 유니크)
      const cols = [];
      results.forEach(r => {
          const k = r.subject || "기타-수행평가";
          if(!cols.includes(k)) cols.push(k);
      });
      
      // 정렬
      cols.sort((a, b) => {
          // 앞부분(과목)만 떼서 우선순위 비교
          const subjA = a.split('-')[0];
          const subjB = b.split('-')[0];
          const idxA = SUBJECT_PRIORITY.indexOf(subjA);
          const idxB = SUBJECT_PRIORITY.indexOf(subjB);
          
          if (idxA !== -1 && idxB !== -1) return idxA - idxB || a.localeCompare(b);
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.localeCompare(b);
      });

      const rows = students.map(std => {
          const row = { studentName: std };
          cols.forEach(c => {
              const m = results.find(r => r.studentName === std && (r.subject||"기타-수행평가")===c);
              row[c] = m ? m.grade : null;
          });
          return row;
      });
      return { columns: cols, rows };
  }, [results, studentRoster]);

  const exportToExcel = () => {
      if (!window.XLSX) return alert("준비중...");
      const data = matrixData.rows.map(r => {
          const row = { '이름': r.studentName };
          matrixData.columns.forEach(c => {
              row[c] = r[c] || "";
          });
          return row;
      });
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), "성적표");
      window.XLSX.writeFile(wb, `성적표_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const handleRowFocus = (item) => {
      setFocusedItem(item);
  };

  return (
    <ErrorBoundary>
        <div className="w-full h-full bg-white flex flex-col font-sans text-slate-900">
            <header className="bg-white border-b px-6 py-3 flex justify-between items-center z-20">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded text-white ${serverStatus==='connected'?'bg-green-600':'bg-red-500'}`}><Server size={20}/></div>
                    <h1 className="font-bold text-lg">개인정보 안심 수행평가 매니저 Pro <span className="text-xs font-normal text-slate-500 ml-2">{serverStatus==='connected' ? "● 서버 연결됨 (v41.0 UI)" : "● 서버 연결 안됨"}</span></h1>
                </div>
                <div className="flex gap-2">
                    <button onClick={()=>setShowRosterModal(true)} className="px-3 py-2 bg-slate-100 rounded text-xs font-bold flex gap-2"><Users size={14}/> 명단 ({studentRoster.length})</button>
                    <button onClick={()=>setShowSettings(!showSettings)} className="p-2 hover:bg-slate-100 rounded"><Settings size={18}/></button>
                </div>
            </header>

            {showRosterModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>setShowRosterModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-96 overflow-hidden" onClick={e=>e.stopPropagation()}>
                        <div className="p-4 border-b flex justify-between font-bold"><span>학생 명단 등록</span><X size={18} onClick={()=>setShowRosterModal(false)} className="cursor-pointer"/></div>
                        <textarea className="w-full h-64 p-4 text-sm outline-none resize-none" placeholder="김철수&#13;&#10;이영희 (줄바꿈으로 구분)" value={rosterInput} onChange={e=>setRosterInput(e.target.value)}/>
                        <div className="p-4 border-t bg-slate-50 text-right"><button onClick={handleSaveRoster} className="bg-black text-white px-4 py-2 rounded text-xs font-bold">저장</button></div>
                    </div>
                </div>
            )}
            {showSettings && (<div className="bg-slate-50 border-b px-6 py-3 text-xs flex gap-4 items-center shadow-inner"><span className="font-bold">기준:</span>{Object.entries(scoreSettings).map(([k,v]) => <div key={k} className="flex items-center gap-1"><span>{k}:</span><input type="number" value={v} onChange={e=>setScoreSettings({...scoreSettings, [k]:parseInt(e.target.value)})} className="w-10 border rounded text-center"/></div>)}</div>)}

            <div className="flex-1 flex overflow-hidden">
                {/* 왼쪽 사이드바: 3단 분할 스마트 뷰어 */}
                <div className="w-[500px] bg-white border-r z-10 flex flex-col">
                    <div className="p-5 flex-1 overflow-y-auto flex flex-col">
                         <div className="mb-6 border-b pb-6 flex-1 flex flex-col">
                            <h3 className="text-sm font-bold mb-3 text-indigo-800 flex items-center gap-2"><Eye size={16}/> 스마트 뷰어 (3단 확인)</h3>
                            
                            {activeItem ? (
                                <div className="flex-1 space-y-2 flex flex-col h-full min-h-0">
                                    {/* 1단: 이름 */}
                                    <div className="flex-1 bg-slate-100 rounded border overflow-hidden relative min-h-[100px]">
                                        <span className="absolute top-1 left-1 bg-black/50 text-white text-[10px] px-2 rounded z-10">1. 이름 영역</span>
                                        {activeItem.cropName ? (
                                            <img src={`data:image/jpeg;base64,${activeItem.cropName}`} className="w-full h-full object-contain"/>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">이미지 없음 (전체보기 권장)</div>
                                        )}
                                    </div>
                                    {/* 2단: 상위 등급 */}
                                    <div className="flex-1 bg-slate-100 rounded border overflow-hidden relative min-h-[100px]">
                                        <span className="absolute top-1 left-1 bg-blue-600/70 text-white text-[10px] px-2 rounded z-10">2. 매우잘함 / 잘함</span>
                                        {activeItem.cropHigh ? (
                                            <img src={`data:image/jpeg;base64,${activeItem.cropHigh}`} className="w-full h-full object-contain"/>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">이미지 없음</div>
                                        )}
                                    </div>
                                    {/* 3단: 하위 등급 */}
                                    <div className="flex-1 bg-slate-100 rounded border overflow-hidden relative min-h-[100px]">
                                        <span className="absolute top-1 left-1 bg-orange-600/70 text-white text-[10px] px-2 rounded z-10">3. 보통 / 노력요함</span>
                                        {activeItem.cropLow ? (
                                            <img src={`data:image/jpeg;base64,${activeItem.cropLow}`} className="w-full h-full object-contain"/>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">이미지 없음</div>
                                        )}
                                    </div>
                                    
                                    <div className="mt-2 text-center">
                                        <div className="text-xl font-bold text-indigo-700">{activeItem.studentName || "(이름 없음)"}</div>
                                        <p className="text-xs text-slate-400 mt-1">오른쪽 표에서 성적을 선택하세요.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center bg-slate-50 rounded border text-slate-400 text-sm text-center p-4">
                                    오른쪽 목록에서<br/>학생을 클릭하면<br/>확대 이미지가 보입니다.
                                </div>
                            )}
                        </div>

                        <div className="mb-2">
                            <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed rounded-lg hover:bg-slate-50 cursor-pointer">
                                <span className="text-xs text-slate-500 font-bold flex items-center gap-1"><Upload size={12}/> 파일 추가</span>
                                <input type="file" className="hidden" multiple onChange={handleFileUpload} />
                            </label>
                        </div>
                        <button onClick={processFiles} disabled={processing} className="w-full py-2 bg-black text-white rounded text-xs font-bold flex justify-center gap-2 disabled:bg-slate-300">
                            {processing ? <Loader2 className="animate-spin" size={14}/> : <ChevronRight size={14}/>} 분석 시작 ({files.length})
                        </button>
                        {processing && <div className="text-center text-xs text-indigo-600 mt-2">{statusMessage}</div>}
                    </div>
                </div>

                {/* 메인 뷰어 */}
                <div className="flex-1 flex flex-col bg-slate-100 overflow-hidden">
                    <div className="bg-white border-b px-4 flex gap-1 pt-2 shrink-0">
                        <button onClick={()=>setViewMode('list')} className={`px-4 py-2 text-xs font-bold rounded-t border-t border-x ${viewMode==='list'?'bg-white border-b-white':'bg-slate-50 text-slate-500'}`}>1. 검수 (입력)</button>
                        <button onClick={()=>setViewMode('matrix')} className={`px-4 py-2 text-xs font-bold rounded-t border-t border-x ${viewMode==='matrix'?'bg-white border-b-white':'bg-slate-50 text-slate-500'}`}>2. 성적표</button>
                        <div className="ml-auto pb-2"><button onClick={exportToExcel} className="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold flex gap-1"><Save size={14}/> 엑셀</button></div>
                    </div>

                    <div className="flex-1 overflow-auto p-6">
                        {results.length === 0 && !processing && (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400"><FileSpreadsheet size={48} className="mb-4 opacity-50"/><p className="text-lg font-bold">데이터가 없습니다</p></div>
                        )}

                        {(results.length > 0 || processing) && viewMode === 'list' && (
                            <div className="max-w-6xl mx-auto pb-20">
                                <div className="bg-white p-3 rounded shadow-sm border mb-4 flex items-center gap-3 sticky top-0 z-30">
                                    <button onClick={toggleSelectAll} className="flex items-center gap-1 text-xs font-bold">{selectedIds.size===results.length?<CheckSquare size={14}/>:<Square size={14}/>} 전체 ({selectedIds.size})</button>
                                    <div className="h-4 w-px bg-slate-300"></div>
                                    <span className="text-xs font-bold flex gap-1"><PenTool size={12}/> 일괄:</span>
                                    <input className="border rounded px-2 py-1 text-xs w-40" placeholder="과목-주제 (예: 수학-덧셈)" value={bulkSubject} onChange={e=>setBulkSubject(e.target.value)}/>
                                    <button onClick={applyBulkEdit} className="bg-black text-white px-3 py-1 rounded text-xs font-bold">적용</button>
                                </div>
                                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                    <table className="grid-table">
                                        <thead><tr><th className="w-10"></th><th className="w-20">확인</th><th>이름 (자동완성)</th><th>과목-주제(단원)</th><th className="w-16">점수</th><th className="w-24">등급</th><th className="w-10"></th></tr></thead>
                                        <tbody>
                                            {results.map((r, index) => (
                                                <tr key={r.id} 
                                                    className={`${selectedIds.has(r.id)?'selected-row':''} ${duplicateIds.has(r.id)?'bg-red-50':''}`}
                                                    onClick={() => handleRowFocus(r)}
                                                >
                                                    <td className="text-center" onClick={(e)=>{e.stopPropagation(); toggleSelect(r.id)}}>{selectedIds.has(r.id)?<CheckSquare size={14} className="mx-auto text-indigo-600"/>:<Square size={14} className="mx-auto text-slate-300"/>}</td>
                                                    <td className="text-center p-1"><div className="w-16 h-8 bg-slate-100 mx-auto cursor-pointer overflow-hidden relative group" onClick={(e)=>{e.stopPropagation(); setPreviewImage(r.fileObj)}}><img src={URL.createObjectURL(r.fileObj)} className="w-full h-full object-cover object-top"/><div className="absolute inset-0 bg-black/10 flex items-center justify-center hidden group-hover:flex"><Eye size={12} className="text-white"/></div></div></td>
                                                    <td className="relative">
                                                        <AutocompleteInput 
                                                            value={r.studentName} 
                                                            roster={studentRoster}
                                                            placeholder="이름 입력 (Tab)"
                                                            onChange={(val) => updateResult(r.id, 'studentName', val)}
                                                        />
                                                        {duplicateIds.has(r.id) && <div className="absolute right-2 top-3 text-red-500"><AlertTriangle size={12}/></div>}
                                                    </td>
                                                    {/* [수정] 과목-주제 통합 열 */}
                                                    <td><input value={r.subject} onChange={e=>updateResult(r.id,'subject',e.target.value)} placeholder="예: 수학-1단원"/></td>
                                                    <td><input value={r.rawScore} onChange={e=>updateResult(r.id,'rawScore',e.target.value)}/></td>
                                                    <td>
                                                        <select value={r.grade} onChange={e=>updateResult(r.id,'grade',e.target.value)}>
                                                            <option value="">- 선택 -</option>
                                                            {GRADES.map(g=><option key={g} value={g}>{g}</option>)}
                                                        </select>
                                                    </td>
                                                    <td className="text-center"><Trash2 size={14} className="mx-auto text-slate-300 hover:text-red-500 cursor-pointer" onClick={()=>deleteResult(r.id)}/></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 성적표 뷰 (Matrix Mode) */}
                        {(results.length > 0 || processing) && viewMode === 'matrix' && (
                            <div className="bg-white rounded border shadow-sm overflow-auto">
                                <table className="grid-table">
                                    <thead>
                                        {/* [수정] 헤더 통합 */}
                                        <tr><th className="w-32 sticky left-0 bg-slate-50 z-10">이름 \ 과목-주제</th>{matrixData.columns.map((c,i)=><th key={i}><div className="text-xs px-2">{c}</div></th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {matrixData.rows.map((r,i) => (
                                            <tr key={i}>
                                                <td className="font-bold sticky left-0 bg-white z-10">{r.studentName}</td>
                                                {matrixData.columns.map((c,j) => {
                                                    const val = r[c];
                                                    return <td key={j} className={val===null?'missing-data':''}><select value={val||""} onChange={e=>{
                                                        const t = results.find(x=>x.studentName===r.studentName && (x.subject||"기타-수행평가")===c);
                                                        if(t) updateResult(t.id,'grade',e.target.value);
                                                    }}>{val===null?<option>-</option>:null}{GRADES.map(g=><option key={g} value={g}>{g}</option>)}</select></td>
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
                {previewImage && <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-10" onClick={()=>setPreviewImage(null)}><img src={URL.createObjectURL(previewImage)} className="max-w-full max-h-full shadow-2xl"/></div>}
            </div>
        </div>
    </ErrorBoundary>
  );
};
export default PrivacyGradeManager;