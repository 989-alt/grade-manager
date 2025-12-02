import React, { useState, useEffect, useMemo } from 'react';
import { Upload, FileSpreadsheet, Trash2, Save, Loader2, CheckCircle, AlertCircle, Eye, X, Settings, Table, List } from 'lucide-react';

// 외부 라이브러리 로드 헬퍼 (CDN)
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
};

// 성적 등급 상수
const GRADES = ["매우 잘함", "잘함", "보통", "노력 요함"];

const PrivacyGradeManager = () => {
  // 상태 관리
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [results, setResults] = useState([]); 
  const [previewImage, setPreviewImage] = useState(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [viewMode, setViewMode] = useState('list'); 
  
  // 점수 변환 설정 (기본값)
  const [scoreSettings, setScoreSettings] = useState({
    veryGood: 90, 
    good: 80,     
    average: 60,  
  });
  const [showSettings, setShowSettings] = useState(false);

  // 초기 라이브러리 로드
  useEffect(() => {
    const initEngine = async () => {
      try {
        setStatusMessage('AI 및 PDF 엔진을 로드 중입니다...');
        await Promise.all([
          loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'),
          loadScript('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'),
          loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
        ]);
        
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        setIsEngineReady(true);
        setStatusMessage('준비 완료');
      } catch (error) {
        console.error("라이브러리 로드 실패:", error);
        setStatusMessage('엔진 로드 실패. 페이지를 새로고침해주세요.');
      }
    };
    initEngine();
  }, []);

  // 점수 자동 변환 로직
  const convertScoreToGrade = (rawInput) => {
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

  // 파일 업로드
  const handleFileUpload = (e) => {
    const uploadedFiles = Array.from(e.target.files);
    if (files.length + uploadedFiles.length > 30) {
      alert("파일은 최대 30개까지만 업로드할 수 있습니다.");
      return;
    }
    setFiles((prev) => [...prev, ...uploadedFiles]);
  };

  // PDF 변환
  const convertPdfToImages = async (file) => {
    const fileUrl = URL.createObjectURL(file);
    const pdf = await window.pdfjsLib.getDocument(fileUrl).promise;
    const images = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport: viewport }).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
      images.push(new File([blob], `${file.name}_page${i}.jpg`, { type: 'image/jpeg' }));
    }
    return images;
  };

  // OCR 처리
  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setViewMode('list'); 
    
    const processedFileNames = new Set(results.map(r => r.parentFileName));
    const filesToProcess = files.filter(f => !processedFileNames.has(f.name));

    if (filesToProcess.length === 0) {
        setProcessing(false);
        alert('모든 파일이 이미 처리되었습니다.');
        return;
    }

    let tempResults = [];
    let totalSteps = filesToProcess.length;
    let currentStep = 0;

    for (const file of filesToProcess) {
      currentStep++;
      setStatusMessage(`[${currentStep}/${totalSteps}] "${file.name}" 준비 중...`);
      let imagesToScan = [];
      
      if (file.type === 'application/pdf') {
        try {
            setStatusMessage(`[${currentStep}/${totalSteps}] "${file.name}" PDF 변환 중...`);
            imagesToScan = await convertPdfToImages(file);
        } catch (e) {
            console.error(e);
            alert(`${file.name} PDF 변환 실패`);
            continue;
        }
      } else {
        imagesToScan = [file];
      }

      for (let i = 0; i < imagesToScan.length; i++) {
        const targetImg = imagesToScan[i];
        setStatusMessage(`[${currentStep}/${totalSteps}] "${file.name}" (Page ${i+1}) 분석 중...`);
        try {
            const { data: { text } } = await window.Tesseract.recognize(
                targetImg, 'kor+eng',
                { logger: m => { if (m.status === 'recognizing text') setProgress(parseInt(m.progress * 100)); } }
            );

            const scoreMatch = text.match(/(\d{1,3})\s*점/);
            const rawScore = scoreMatch ? scoreMatch[1] : '';
            const nameMatch = text.match(/[가-힣]{3}/g);
            const nameCandidate = nameMatch ? nameMatch[0] : '';
            const subjects = ["국어", "수학", "영어", "과학", "사회", "역사", "도덕", "기가", "음악", "미술", "체육"];
            const foundSubject = subjects.find(s => text.includes(s)) || "";

            tempResults.push({
                id: Date.now() + Math.random(),
                parentFileName: file.name,
                fileObj: targetImg,
                rawText: text,
                studentName: nameCandidate,
                subject: foundSubject,
                rawScore: rawScore,
                grade: convertScoreToGrade(rawScore),
                isVerified: false
            });
        } catch (err) { console.error(err); }
      }
    }
    setResults(prev => [...prev, ...tempResults]);
    setProcessing(false);
    setStatusMessage('분석 완료! 매트릭스 뷰에서 결과를 확인하세요.');
    setProgress(0);
    setViewMode('matrix'); 
  };

  const updateResult = (id, field, value) => {
    setResults(prev => prev.map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value, isVerified: true };
        if (field === 'rawScore') updated.grade = convertScoreToGrade(value);
        return updated;
    }));
  };

  const deleteResult = (id) => { setResults(results.filter(r => r.id !== id)); };

  const matrixData = useMemo(() => {
    const students = [...new Set(results.map(r => r.studentName).filter(n => n))].sort();
    const subjects = [...new Set(results.map(r => r.subject).filter(s => s))];
    const rows = students.map(student => {
        const rowData = { studentName: student };
        subjects.forEach(subj => {
            const match = results.find(r => r.studentName === student && r.subject === subj);
            rowData[subj] = match ? match.grade : '-';
        });
        return rowData;
    });
    return { students, subjects, rows };
  }, [results]);

  const exportToExcel = () => {
    if (matrixData.rows.length === 0) { alert("내보낼 데이터가 없습니다."); return; }
    if (!window.XLSX) return;
    const ws = window.XLSX.utils.json_to_sheet(matrixData.rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "성적일람표");
    const rawData = results.map(r => ({
        '파일': r.parentFileName, '학생': r.studentName, '과목': r.subject, '점수(숫자)': r.rawScore, '등급': r.grade
    }));
    const wsRaw = window.XLSX.utils.json_to_sheet(rawData);
    window.XLSX.utils.book_append_sheet(wb, wsRaw, "상세데이터");
    const date = new Date().toISOString().slice(0,10).replace(/-/g,"");
    window.XLSX.writeFile(wb, `수행평가_매트릭스_${date}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-800">
      <div className="w-full space-y-6">
        <header className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3 mb-2">
                <div className="bg-indigo-600 p-2 rounded-lg"><FileSpreadsheet className="text-white w-6 h-6" /></div>
                <h1 className="text-2xl font-bold text-slate-900">개인정보 안심 수행평가 매니저 Pro</h1>
            </div>
            <p className="text-slate-600 text-sm">PDF 지원 • 점수 자동 등급 변환 • 학생별 정렬<span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">🔒 로컬 보안 처리</span></p>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"><Settings className="w-4 h-4" /> 점수 기준 설정</button>
        </header>

        {showSettings && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 bg-indigo-50/50">
                <h3 className="font-semibold mb-4 text-indigo-900">점수 → 등급 자동 변환 기준 설정</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex items-center gap-3"><span className="w-24 font-medium text-sm text-slate-700">매우 잘함</span><input type="number" value={scoreSettings.veryGood} onChange={(e) => setScoreSettings({...scoreSettings, veryGood: parseInt(e.target.value)})} className="w-20 px-3 py-2 border rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/><span className="text-sm text-slate-500">점 이상</span></div>
                    <div className="flex items-center gap-3"><span className="w-24 font-medium text-sm text-slate-700">잘함</span><input type="number" value={scoreSettings.good} onChange={(e) => setScoreSettings({...scoreSettings, good: parseInt(e.target.value)})} className="w-20 px-3 py-2 border rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/><span className="text-sm text-slate-500">점 이상</span></div>
                    <div className="flex items-center gap-3"><span className="w-24 font-medium text-sm text-slate-700">보통</span><input type="number" value={scoreSettings.average} onChange={(e) => setScoreSettings({...scoreSettings, average: parseInt(e.target.value)})} className="w-20 px-3 py-2 border rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/><span className="text-sm text-slate-500">점 이상</span></div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[700px]">
            <div className="lg:col-span-1 flex flex-col gap-4">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col">
                    <h2 className="font-semibold text-lg mb-4 flex items-center gap-2"><Upload className="w-5 h-5" /> 파일 등록</h2>
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors mb-4">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6"><Upload className="w-6 h-6 text-slate-400 mb-2" /><p className="text-xs text-slate-500 text-center"><span className="font-semibold">이미지/PDF 업로드</span><br/>(최대 30개)</p></div>
                        <input type="file" className="hidden" multiple accept="image/*,application/pdf" onChange={handleFileUpload} />
                    </label>
                    <div className="text-sm text-slate-600 mb-4 space-y-1"><div className="flex justify-between"><span>등록된 파일:</span><span className="font-bold">{files.length} / 30</span></div><div className="flex justify-between"><span>분석된 페이지:</span><span className="font-bold">{results.length}</span></div></div>
                    {!isEngineReady ? ( <button disabled className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 text-white bg-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> 엔진 로딩 중...</button> ) : ( <button onClick={processFiles} disabled={processing || files.length === 0} className={`w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-medium text-white transition-all text-sm ${processing || files.length === 0 ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md'}`}>{processing ? <Loader2 className="w-4 h-4 animate-spin" /> : '분석 및 정리 시작'}</button> )}
                    {processing && (<div className="mt-4 p-3 bg-blue-50 text-blue-700 text-xs rounded-lg animate-pulse"><p className="font-semibold mb-1">분석 진행률: {progress}%</p><p>{statusMessage}</p></div>)}
                </div>
            </div>
            <div className="lg:col-span-3 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200">
                    <button onClick={() => setViewMode('list')} className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${viewMode === 'list' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}><List className="w-4 h-4" /> 데이터 검수 (개별 수정)</button>
                    <button onClick={() => setViewMode('matrix')} className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${viewMode === 'matrix' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}><Table className="w-4 h-4" /> 최종 성적표 (학생별 정렬)</button>
                </div>
                <div className="flex-1 overflow-hidden relative">
                    {results.length === 0 && !processing && (<div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><FileSpreadsheet className="w-16 h-16 mb-4 opacity-20" /><p>왼쪽에서 파일을 업로드하고 분석을 시작하세요.</p></div>)}
                    {viewMode === 'list' && results.length > 0 && (
                        <div className="h-full overflow-auto p-4">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10"><tr><th className="px-3 py-3 w-14 text-center border-b">원본</th><th className="px-3 py-3 border-b">학생 이름</th><th className="px-3 py-3 border-b">과목</th><th className="px-3 py-3 w-24 border-b">점수(숫자)</th><th className="px-3 py-3 w-32 border-b">최종 등급</th><th className="px-3 py-3 w-12 text-center border-b">삭제</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">{results.map((item) => (<tr key={item.id} className="hover:bg-slate-50 group"><td className="px-3 py-2 text-center"><button onClick={() => setPreviewImage(item.fileObj)} className="p-1 border rounded hover:border-indigo-500"><Eye className="w-4 h-4 text-slate-400 hover:text-indigo-500" /></button></td><td className="px-3 py-2"><input type="text" value={item.studentName} onChange={(e) => updateResult(item.id, 'studentName', e.target.value)} className="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none py-1" placeholder="이름 확인 필요"/></td><td className="px-3 py-2"><input type="text" value={item.subject} onChange={(e) => updateResult(item.id, 'subject', e.target.value)} className="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none py-1" placeholder="과목 입력"/></td><td className="px-3 py-2"><input type="text" value={item.rawScore} onChange={(e) => updateResult(item.id, 'rawScore', e.target.value)} className="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none py-1 font-mono text-center" placeholder="-"/></td><td className="px-3 py-2"><select value={item.grade} onChange={(e) => updateResult(item.id, 'grade', e.target.value)} className={`w-full text-xs py-1 rounded border-none focus:ring-1 focus:ring-indigo-500 ${item.grade === '매우 잘함' ? 'bg-green-100 text-green-800' : item.grade === '잘함' ? 'bg-blue-100 text-blue-800' : item.grade === '보통' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-50 text-red-800'}`}><option value="">(선택)</option>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}</select></td><td className="px-3 py-2 text-center"><button onClick={() => deleteResult(item.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>))}</tbody>
                            </table>
                        </div>
                    )}
                    {viewMode === 'matrix' && results.length > 0 && (
                        <div className="h-full flex flex-col">
                            <div className="flex justify-between items-center p-4 bg-indigo-50/30 border-b border-indigo-100"><div className="text-sm text-indigo-900"><span className="font-bold">{matrixData.students.length}명</span>의 학생, <span className="font-bold ml-1">{matrixData.subjects.length}개</span> 과목이 집계되었습니다.</div><button onClick={exportToExcel} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm font-medium shadow-sm"><Save className="w-4 h-4" /> 엑셀 다운로드</button></div>
                            <div className="flex-1 overflow-auto p-4">
                                <table className="w-full text-sm border-collapse border border-slate-300">
                                    <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0 z-10 shadow-sm"><tr><th className="border border-slate-300 px-4 py-2 bg-slate-100">이름 \ 과목</th>{matrixData.subjects.map(subj => (<th key={subj} className="border border-slate-300 px-4 py-2 min-w-[100px]">{subj || "(과목미상)"}</th>))}</tr></thead>
                                    <tbody>{matrixData.rows.map((row, idx) => (<tr key={idx} className="hover:bg-indigo-50/50 even:bg-slate-50"><td className="border border-slate-300 px-4 py-2 font-medium text-slate-900 bg-white sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{row.studentName || "(이름미상)"}</td>{matrixData.subjects.map(subj => { const val = row[subj]; return (<td key={subj} className="border border-slate-300 px-4 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded text-xs ${val === '매우 잘함' ? 'bg-green-100 text-green-800' : val === '잘함' ? 'bg-blue-100 text-blue-800' : val === '보통' ? 'bg-yellow-100 text-yellow-800' : val === '노력 요함' ? 'bg-red-50 text-red-800' : 'text-slate-400'}`}>{val}</span></td>); })}</tr>))}</tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2 text-xs text-yellow-800"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><p><strong>보안 주의사항:</strong> 이 프로그램은 구조적으로 외부 서버와 통신하지 않도록 설계되었습니다. 모든 데이터 처리는 선생님의 컴퓨터(브라우저 메모리)에서만 수행되며, 페이지를 새로고침하면 모든 데이터가 사라집니다. 중요한 작업 후에는 반드시 "엑셀 다운로드"를 눌러 결과를 저장하세요.</p></div>
        {previewImage && (<div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewImage(null)}><div className="bg-white rounded-lg p-2 max-w-4xl max-h-[90vh] relative shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}><div className="flex justify-between items-center p-2 border-b mb-2"><span className="font-semibold text-slate-700 text-sm">원본 이미지 확인</span><button onClick={() => setPreviewImage(null)} className="p-1 hover:bg-slate-100 rounded-full"><X className="w-5 h-5" /></button></div><div className="overflow-auto flex-1 bg-slate-100 flex items-center justify-center min-h-[300px]"><img src={URL.createObjectURL(previewImage)} alt="preview" className="max-w-full max-h-[70vh] object-contain shadow-md"/></div></div></div>)}
      </div>
    </div>
  );
};
export default PrivacyGradeManager;