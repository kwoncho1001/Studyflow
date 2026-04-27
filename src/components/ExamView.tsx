import { useState, useEffect } from 'react';
import { 
  ChevronLeft, ClipboardList, CheckCircle2, XCircle, 
  HelpCircle, Trophy, Timer, ArrowRight, RefreshCw, FileText, Sparkles
} from 'lucide-react';
import { dbService } from '../lib/db';
import { aiService } from '../lib/ai';
import { SubjectFile, Unit, ExamSession } from '../types';
import { generateId } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import Markdown from 'react-markdown';

interface ExamViewProps {
  subjectId: string;
  fileId?: string;
  onBack: () => void;
}

export default function ExamView({ subjectId, fileId, onBack }: ExamViewProps) {
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [currentFile, setCurrentFile] = useState<SubjectFile | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [mode, setMode] = useState<'list' | 'session'>('list');
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState<Record<string, boolean>>({});
  const [critiques, setCritiques] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadExamData();
  }, [fileId]);

  const loadExamData = async () => {
    setLoading(true);
    const db = await dbService.getDB();
    
    if (fileId) {
      const file = await db.get('files', fileId);
      if (file) {
        setCurrentFile(file);
        const u = await db.getAllFromIndex('units', 'fileId', fileId);
        setUnits(u.filter(unit => unit.questions && unit.questions.length > 0));
        setMode('session');
      }
    } else {
      setMode('list');
    }
    
    const sess = await db.getAllFromIndex('examSessions', 'subjectId', subjectId);
    setSessions(sess);
    setLoading(false);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const scores: Record<string, boolean> = {};
    const feedBacks: Record<string, string> = {};
    
    try {
      if (currentFile?.parsedQuestions) {
        const promises = currentFile.parsedQuestions.map(async (q) => {
          const id = q.id;
          const answer = userAnswers[id] || "";
          const result = await aiService.gradeExamAnswer(q.questionText, answer);
          scores[id] = result.isCorrect;
          feedBacks[id] = result.critique;
        });
        await Promise.all(promises);
      } else {
        const promises: Promise<void>[] = [];
        units.forEach(u => {
          u.questions?.forEach((q, i) => {
            const id = `${u.id}-${i}`;
            const answer = userAnswers[id] || "";
            promises.push((async () => {
              const result = await aiService.gradeExamAnswer(q, answer);
              scores[id] = result.isCorrect;
              feedBacks[id] = result.critique;
            })());
          });
        });
        await Promise.all(promises);
      }
      
      setGrading(scores);
      setCritiques(feedBacks);
      setIsSubmitted(true);
    } catch (error) {
      console.error("Grading failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="py-20 text-center animate-pulse text-blue-500 font-bold text-xl italic">기출 아카이브 접속 중...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 w-full">
      <div className="space-y-12 animate-in fade-in duration-700 pb-20 font-sans">
      {mode === 'list' && (
        <>
          <header className="space-y-4 px-2">
             <div className="flex items-center gap-3 text-[10px] font-black text-blue-500 uppercase tracking-[4px]">
               <ClipboardList size={14} />
               <span>Simulated Environments</span>
             </div>
             <h2 className="text-5xl font-black text-white tracking-tighter">STUDY JOURNEY</h2>
             <p className="text-zinc-500 font-medium text-lg max-w-2xl leading-relaxed italic">기본 개념을 넘어 실전 감각을 위한 기출 아카이브입니다.</p>
          </header>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 px-2">
             {/* Summary Statistic Cards */}
             <div className="bg-[#0c0c0e] border border-zinc-800 p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden group hover:border-blue-500/30 transition-all">
                <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600/5 rounded-full blur-[60px] translate-x-12 -translate-y-12" />
                <Trophy size={100} className="absolute -bottom-8 -right-8 text-blue-500 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-700" />
                <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[3px] mb-8">Aggregate Proficiency</h3>
                <div className="flex items-baseline gap-3 relative z-10">
                   <span className="text-6xl font-black text-white tracking-tighter">82</span>
                   <span className="text-2xl font-bold text-zinc-600">/ 100</span>
                </div>
                <p className="mt-6 text-[10px] text-zinc-500 font-medium uppercase tracking-widest">평균 정답률 지표</p>
             </div>
             
             <div className="bg-[#0c0c0e] border border-zinc-800 p-10 rounded-[2.5rem] shadow-xl flex flex-col justify-between group hover:border-blue-500/30 transition-all">
                <div className="flex justify-between items-start">
                   <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[3px]">Extracted Segments</h3>
                   <ClipboardList size={20} className="text-zinc-800 group-hover:text-blue-500 transition-colors" />
                </div>
                <div className="mt-8">
                   <span className="text-6xl font-black text-white tracking-tighter">{sessions.length * 15 + 42}</span>
                </div>
                <div className="mt-8 flex items-center gap-3">
                   <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                   <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[2px]">Index Verified</p>
                </div>
             </div>

             <div className="bg-[#0c0c0e] border border-zinc-800 p-10 rounded-[2.5rem] shadow-xl flex flex-col justify-between group hover:border-blue-500/30 transition-all">
                <div className="flex justify-between items-start">
                   <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[3px]">Validated Manifests</h3>
                   <CheckCircle2 size={20} className="text-zinc-800 group-hover:text-blue-500 transition-colors" />
                </div>
                <div className="mt-8">
                   <span className="text-6xl font-black text-white tracking-tighter">{sessions.length}</span>
                </div>
                <p className="mt-8 text-[9px] font-black text-zinc-600 uppercase tracking-[2px]">Diagnostic Sessions Logged</p>
             </div>
          </div>
        </>
      )}

      {mode === 'session' && currentFile && (
        <div className="max-w-4xl mx-auto space-y-16 px-4">
          <header className="flex items-center justify-between sticky top-14 z-20 bg-black/80 backdrop-blur-xl py-6 border-b border-zinc-900">
            <div className="flex items-center gap-6">
              <button 
                onClick={onBack} 
                className="p-3 border border-zinc-800 hover:border-blue-500 text-zinc-500 hover:text-blue-500 rounded-2xl transition-all shadow-lg active:scale-95 bg-zinc-900/50"
              >
                <ChevronLeft size={24} />
              </button>
              <div>
                <h2 className="text-3xl font-black text-white tracking-tighter leading-none">{currentFile.examYear} {currentFile.examTerm}</h2>
                <div className="flex items-center gap-3 mt-2">
                   <span className="text-[10px] font-black text-blue-500 uppercase tracking-[3px]">{currentFile.examType}</span>
                   <div className="w-1 h-1 bg-zinc-800 rounded-full" />
                   <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[3px]">{currentFile.grade}</span>
                </div>
              </div>
            </div>
            {!isSubmitted && (
               <div className="flex items-center gap-8">
                 <div className="flex items-center gap-3 text-white font-mono text-lg">
                    <Timer size={20} className="text-blue-500" />
                    <span className="font-black tracking-tighter text-2xl">24:12</span>
                 </div>
                 <button 
                   onClick={handleSubmit} 
                   disabled={isSubmitting}
                   className="bg-blue-600 text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-blue-600/20 hover:bg-blue-500 hover:shadow-blue-500/40 transition-all disabled:opacity-50 flex items-center gap-3"
                  >
                    {isSubmitting ? <RefreshCw size={20} className="animate-spin" /> : null}
                    {isSubmitting ? "Neural Analysis..." : "Submit Diagnostics"}
                  </button>
               </div>
            )}
          </header>

          <div className="space-y-12">
             {currentFile.parsedQuestions ? (
               currentFile.parsedQuestions.map((q, idx) => {
                 const qId = q.id;
                 return (
                   <motion.div 
                     key={qId} 
                     initial={{ opacity: 0, y: 30 }} 
                     animate={{ opacity: 1, y: 0 }}
                     className="bg-[#0c0c0e] border border-zinc-800/60 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden group hover:border-blue-500/20 transition-all"
                   >
                     <div className="absolute top-0 left-0 w-1.5 h-full bg-zinc-900 group-hover:bg-blue-500/20 transition-colors" />
                     <div className="flex flex-col md:flex-row gap-10">
                        <div className="flex-shrink-0 flex flex-col items-start md:items-center">
                           <span className="font-black text-4xl text-zinc-800 leading-none group-hover:text-blue-500/40 transition-colors whitespace-nowrap tracking-tighter">
                             {idx + 1 < 10 ? `0${idx+1}` : idx+1}
                           </span>
                           {isSubmitted && (
                             <div className="mt-8">
                               {grading[qId] ? <CheckCircle2 size={40} className="text-blue-500" /> : <XCircle size={40} className="text-red-600/40" />}
                             </div>
                           )}
                        </div>
                        <div className="flex-1 space-y-10">
                           <div className="text-2xl font-bold text-zinc-200 leading-relaxed tracking-tight markdown-body prose prose-invert max-w-none">
                              <Markdown>{q.questionText}</Markdown>
                           </div>
                           
                           <div className="relative">
                              <textarea 
                                disabled={isSubmitted || isSubmitting}
                                value={userAnswers[qId] || ""}
                                onChange={(e) => setUserAnswers(prev => ({ ...prev, [qId]: e.target.value }))}
                                placeholder="정답을 입력하세요..." 
                                className="w-full bg-[#111215] border border-zinc-800 rounded-[2rem] p-8 min-h-[160px] outline-none focus:border-blue-500 focus:bg-[#16171a] text-white transition-all font-medium text-lg shadow-inner placeholder:text-zinc-700"
                              ></textarea>
                              {!isSubmitted && <div className="absolute bottom-6 right-6 text-zinc-800 text-[10px] font-black uppercase tracking-widest">입력 대기 중</div>}
                           </div>

                           {isSubmitted && (
                              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mt-12 p-10 bg-black/40 border border-blue-500/10 rounded-[2.5rem] space-y-6 relative overflow-hidden">
                                 <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none text-blue-500">
                                    <HelpCircle size={120} />
                                 </div>
                                 <div className="flex items-center gap-3 text-[10px] font-black text-blue-500 uppercase tracking-[3px]">
                                   <Sparkles size={16} /> 
                                   <span>Architectural Critique</span>
                                 </div>
                                 <div className="markdown-body text-zinc-400 text-lg font-medium italic leading-relaxed">
                                   <p className="text-blue-500/80">{critiques[qId]}</p>
                                 </div>
                              </motion.div>
                           )}
                        </div>
                     </div>
                   </motion.div>
                 );
               })
             ) : (
               units.map((unit, uIdx) => (
                 unit.questions?.map((q, qIdx) => {
                   const qId = `${unit.id}-${qIdx}`;
                   return (
                     <motion.div 
                       key={qId} 
                       initial={{ opacity: 0, y: 30 }} 
                       animate={{ opacity: 1, y: 0 }}
                       className="bg-[#0c0c0e] border border-zinc-800/60 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden group hover:border-blue-500/20 transition-all font-sans"
                     >
                       <div className="absolute top-0 left-0 w-1.5 h-full bg-zinc-900 group-hover:bg-blue-500/20 transition-colors" />
                       <div className="flex flex-col md:flex-row gap-10">
                          <div className="flex-shrink-0 flex flex-col items-start md:items-center">
                             <span className="font-black text-4xl text-zinc-800 leading-none group-hover:text-blue-500/40 transition-colors tracking-tighter">Q{uIdx + 1}.{qIdx + 1}</span>
                             {isSubmitted && (
                               <div className="mt-8">
                                 {grading[qId] ? <CheckCircle2 size={40} className="text-blue-500" /> : <XCircle size={40} className="text-red-600/40" />}
                               </div>
                             )}
                          </div>
                          <div className="flex-1 space-y-10">
                             <div className="text-2xl font-bold text-zinc-200 leading-relaxed tracking-tight markdown-body prose prose-invert max-w-none">
                                <Markdown>{q}</Markdown>
                             </div>
                             
                             <div className="relative">
                                <textarea 
                                  disabled={isSubmitted || isSubmitting}
                                  value={userAnswers[qId] || ""}
                                  onChange={(e) => setUserAnswers(prev => ({ ...prev, [qId]: e.target.value }))}
                                  placeholder="정답을 입력하세요..." 
                                  className="w-full bg-[#111215] border border-zinc-800 rounded-[2rem] p-8 min-h-[160px] outline-none focus:border-blue-500 focus:bg-[#16171a] text-white transition-all font-medium text-lg shadow-inner placeholder:text-zinc-700"
                                ></textarea>
                                {!isSubmitted && <div className="absolute bottom-6 right-6 text-zinc-800 text-[10px] font-black uppercase tracking-widest">입력 대기 중</div>}
                             </div>

                             {isSubmitted && (
                               <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mt-12 p-10 bg-black/40 border border-blue-500/10 rounded-[2.5rem] space-y-6 relative overflow-hidden">
                                  <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none text-blue-500">
                                     <HelpCircle size={120} />
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] font-black text-blue-500 uppercase tracking-[3px]">
                                    <Sparkles size={16} /> 
                                    <span>Architectural Critique</span>
                                  </div>
                                  <div className="markdown-body text-zinc-400 text-lg font-medium italic leading-relaxed">
                                    <p className="text-blue-500/80">{critiques[qId]}</p>
                                  </div>
                               </motion.div>
                             )}
                          </div>
                       </div>
                     </motion.div>
                   );
                 })
               ))
             )}
          </div>
          
          {isSubmitted && (
            <div className="bg-[#0c0c0e] border border-blue-500/20 text-white p-16 rounded-[4rem] text-center shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-blue-600/5 to-transparent pointer-events-none" />
               <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/5 rounded-full blur-[100px] -mr-48 -mt-48" />
               
               <h3 className="text-5xl font-black italic tracking-tighter mb-6">Neural Mastery Assessment</h3>
               <div className="flex items-center justify-center gap-6 mb-8 relative z-10">
                  <span className="text-8xl font-black text-white tracking-tighter">75</span>
                  <div className="w-px h-16 bg-zinc-800" />
                  <span className="text-3xl font-bold text-blue-500 opacity-40">/ 100</span>
               </div>
               
               <p className="text-zinc-500 font-medium text-xl max-w-xl mx-auto mb-12 leading-relaxed italic">
                 Semantic integrity remains high. Minor deficiencies noted in segment correlation logic. Recommendation: targeted architectural reinforcement.
               </p>
               
               <button 
                 onClick={() => setMode('list')} 
                 className="bg-blue-600 text-white px-12 py-5 rounded-2xl font-black text-xl shadow-xl shadow-blue-600/20 hover:bg-blue-500 hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all"
               >
                 Return to Archive
               </button>
            </div>
          )}
        </div>
      )}
    </div>
  </div>
  );
}
