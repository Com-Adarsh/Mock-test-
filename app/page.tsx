"use client";
import React, { useState, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Upload, Clock, CheckCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [isExamStarted, setIsExamStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(3600);
  const [userAnswers, setUserAnswers] = useState({});

  const extractText = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((item: any) => item.str).join(" ");
    }
    return fullText;
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    try {
      const text = await extractText(e.target.files[0]);
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setQuestions(data);
    } catch (err) {
      alert("Error processing PDF");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isExamStarted && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isExamStarted, timeLeft]);

  if (!isExamStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white max-w-lg w-full rounded-3xl shadow-xl p-10 border-t-[10px] border-[#8B0000]">
          <h1 className="text-3xl font-black text-slate-800 mb-2">CUSAT CBT Portal</h1>
          <p className="text-slate-500 mb-8 font-medium">Automatic Exam Generation from PDF</p>
          
          <div className="relative group">
            <input type="file" onChange={onFileChange} className="hidden" id="upload" accept=".pdf" />
            <label htmlFor="upload" className="flex flex-col items-center justify-center w-full h-44 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:bg-red-50 hover:border-[#8B0000] transition-all">
              {loading ? <Loader2 className="animate-spin text-[#8B0000] w-10 h-10" /> : <Upload className="text-slate-300 group-hover:text-[#8B0000] w-10 h-10 mb-3" />}
              <span className="font-bold text-slate-500">{loading ? "Processing with AI..." : "Upload Question Paper PDF"}</span>
            </label>
          </div>

          {questions.length > 0 && (
            <button onClick={() => setIsExamStarted(true)} className="w-full mt-8 bg-[#8B0000] text-white py-4 rounded-xl font-bold shadow-lg hover:bg-red-700 transition">
              Launch Test ({questions.length} Questions)
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-[#8B0000] text-white p-4 px-8 flex justify-between items-center shadow-lg">
        <h2 className="font-bold tracking-tighter text-lg uppercase">CUSAT Student Union Mock Portal</h2>
        <div className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-lg font-mono text-xl">
          <Clock className="w-5 h-5" />
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </div>
      </header>

      <div className="flex-grow grid grid-cols-12 p-6 gap-6">
        <div className="col-span-12 lg:col-span-9">
          <div className="bg-white rounded-2xl shadow-sm border p-10 h-full relative">
            <span className="text-xs font-black text-[#8B0000] uppercase">Question {current + 1}</span>
            <h3 className="text-2xl font-semibold text-slate-800 mt-4 mb-10 leading-snug">{questions[current].q}</h3>
            
            <div className="space-y-4">
              {questions[current].options.map((opt, i) => (
                <button key={i} onClick={() => setUserAnswers({...userAnswers, [current]: i})} className={`w-full text-left p-5 rounded-xl border-2 transition-all flex items-center ${userAnswers[current] === i ? 'border-[#8B0000] bg-red-50' : 'border-slate-100 hover:border-slate-300 bg-slate-50'}`}>
                  <div className={`w-6 h-6 rounded-full border-2 mr-4 flex items-center justify-center text-xs font-bold ${userAnswers[current] === i ? 'bg-[#8B0000] border-[#8B0000] text-white' : 'border-slate-300 text-slate-400'}`}>{i + 1}</div>
                  <span className={userAnswers[current] === i ? 'text-[#8B0000] font-bold' : 'text-slate-600 font-medium'}>{opt}</span>
                </button>
              ))}
            </div>

            <div className="mt-20 flex justify-between pt-6 border-t">
              <button disabled={current === 0} onClick={() => setCurrent(c => c - 1)} className="flex items-center gap-2 font-bold text-slate-400 hover:text-slate-800 disabled:opacity-0"><ChevronLeft /> Previous</button>
              <button onClick={() => current < questions.length - 1 ? setCurrent(c => c + 1) : alert("Ready to Submit?")} className="bg-[#8B0000] text-white px-10 py-3 rounded-xl font-bold shadow-md hover:bg-red-700 transition">Save & Next</button>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3">
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase mb-4">Navigator</h4>
            <div className="grid grid-cols-4 gap-2">
              {questions.map((_, i) => (
                <button key={i} onClick={() => setCurrent(i)} className={`h-10 rounded font-bold text-sm transition-all ${current === i ? 'bg-[#8B0000] text-white scale-110 shadow-lg' : userAnswers[i] !== undefined ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</button>
              ))}
            </div>
            <button className="w-full mt-8 bg-slate-900 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-black transition"><CheckCircle className="w-5 h-5 text-green-400" /> Final Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
    const data = await res.json();
    setQuestions(data);
    setLoading(false);
  };

  // 2. Timer Logic
  useEffect(() => {
    if (isStarted && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isStarted, timeLeft]);

  // 3. UI Components
  if (!isStarted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 border-t-[12px] border-[#8B0000]">
          <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">CBT AI</h1>
          <p className="text-slate-500 mb-8 font-medium">Examiner Portal: Upload PDF to Start</p>
          
          <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:bg-red-50 hover:border-[#8B0000] transition-all group">
            <Upload className="w-12 h-12 text-slate-300 group-hover:text-[#8B0000] mb-4" />
            <span className="text-sm font-bold text-slate-500 group-hover:text-[#8B0000]">
              {loading ? "AI is processing..." : "Upload Exam PDF"}
            </span>
            <input type="file" className="hidden" onChange={handleFileUpload} accept="application/pdf" />
          </label>

          {questions.length > 0 && (
            <button onClick={() => setIsStarted(true)} className="w-full mt-8 bg-[#8B0000] text-white py-4 rounded-xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-red-200">
              Launch Exam ({questions.length} Questions)
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Header */}
      <header className="bg-[#8B0000] text-white px-8 py-4 flex justify-between items-center shadow-xl z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center text-[#8B0000] font-black italic">S</div>
          <span className="font-bold tracking-widest text-sm hidden md:block">MOCK TEST INTERFACE</span>
        </div>
        <div className="flex items-center gap-4 bg-black/20 px-4 py-2 rounded-lg font-mono text-xl">
          <Clock className="w-5 h-5" />
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-grow grid grid-cols-12 overflow-hidden">
        {/* Question Area */}
        <div className="col-span-12 lg:col-span-9 p-6 overflow-y-auto">
          <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-10">
            <div className="flex justify-between items-center mb-8">
              <span className="bg-red-100 text-[#8B0000] px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                Question {currentIndex + 1} of {questions.length}
              </span>
            </div>
            
            <h2 className="text-2xl font-semibold text-slate-800 mb-10 leading-relaxed">
              {questions[currentIndex]?.q}
            </h2>

            <div className="grid grid-cols-1 gap-4">
              {questions[currentIndex]?.options.map((opt, i) => (
                <button 
                  key={i} 
                  onClick={() => setAnswers({...answers, [currentIndex]: i})}
                  className={`w-full text-left p-5 rounded-xl border-2 transition-all flex items-center group
                    ${answers[currentIndex] === i ? 'border-[#8B0000] bg-red-50' : 'border-slate-100 hover:border-slate-300 bg-slate-50'}`}
                >
                  <div className={`w-6 h-6 rounded-full border-2 mr-4 flex items-center justify-center text-xs font-bold
                    ${answers[currentIndex] === i ? 'bg-[#8B0000] border-[#8B0000] text-white' : 'border-slate-300 text-slate-400 group-hover:border-[#8B0000]'}`}>
                    {String.fromCharCode(65 + i)}
                  </div>
                  <span className={`font-medium ${answers[currentIndex] === i ? 'text-[#8B0000]' : 'text-slate-600'}`}>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <aside className="hidden lg:block lg:col-span-3 bg-white border-l border-slate-200 p-6 shadow-inner">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Question Navigator</h3>
          <div className="grid grid-cols-5 gap-3">
            {questions.map((_, i) => (
              <button 
                key={i} 
                onClick={() => setCurrentIndex(i)}
                className={`h-11 rounded-lg font-bold text-sm transition-all shadow-sm
                  ${currentIndex === i ? 'bg-[#8B0000] text-white scale-110 shadow-red-200' : 
                    answers[i] !== undefined ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </aside>
      </main>

      {/* Action Footer */}
      <footer className="bg-white border-t border-slate-200 p-4 flex justify-between items-center px-10">
        <button 
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex(c => c - 1)}
          className="flex items-center gap-2 font-bold text-slate-400 hover:text-slate-800 disabled:opacity-0 transition-all"
        >
          <ChevronLeft /> PREVIOUS
        </button>

        <button className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-400" /> SUBMIT EXAM
        </button>

        <button 
          onClick={() => currentIndex < questions.length - 1 ? setCurrentIndex(c => c + 1) : null}
          className="flex items-center gap-2 font-bold text-[#8B0000] hover:translate-x-1 transition-all"
        >
          SAVE & NEXT <ChevronRight />
        </button>
      </footer>
    </div>
  );
}
