"use client";
import React, { useState, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Upload, ChevronLeft, ChevronRight, CheckCircle, Clock } from 'lucide-react';

// Initialize PDF.js Worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function CBTPortal() {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1800);
  const [answers, setAnswers] = useState({});

  // 1. PDF Text Extraction Logic
  const extractText = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(" ");
    }
    return text;
  };

  const handleFileUpload = async (e: any) => {
    setLoading(true);
    const text = await extractText(e.target.files[0]);
    const res = await fetch('/api/parse', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
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
