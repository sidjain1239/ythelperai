'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Bot, BrainCircuit, Clapperboard, Languages, List, Loader, Plus, Send, Sparkles, TestTube, User, Youtube } from 'lucide-react';

export default function AIHelper() {
  const [videoUrl, setVideoUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedMode, setSelectedMode] = useState('full');
  const [timelineClock, setTimelineClock] = useState({ startH: '0', startM: '0', startS: '0', endH: '0', endM: '5', endS: '0' });
  const [selectedChapterIndexes, setSelectedChapterIndexes] = useState([]);
  const [transcript, setTranscript] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  
  // Chat states
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryLanguage, setSummaryLanguage] = useState('english');
  const chatEndRef = useRef(null);

  // Quiz states
  const [quizConfig, setQuizConfig] = useState({
    questionCount: 5,
    language: 'english'
  });
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch video details
  const toSecondsFromClock = (clock, prefix) => {
    const h = Number(clock[`${prefix}H`]) || 0;
    const m = Number(clock[`${prefix}M`]) || 0;
    const s = Number(clock[`${prefix}S`]) || 0;
    return (h * 3600) + (m * 60) + s;
  };

  const toClock = (totalSec) => {
    const safe = Math.max(0, Number(totalSec) || 0);
    return {
      h: String(Math.floor(safe / 3600)),
      m: String(Math.floor((safe % 3600) / 60)),
      s: String(Math.floor(safe % 60)),
    };
  };

  const fetchVideoDetails = async () => {
    if (!videoUrl.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/video-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ytLink: videoUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setVideoInfo(data);
      setSelectedChapterIndexes([]);
      const defaultEnd = Math.min(Number(data?.durationSec || 300), 300);
      const endClock = toClock(defaultEnd || 300);
      setTimelineClock({ startH: '0', startM: '0', startS: '0', endH: endClock.h, endM: endClock.m, endS: endClock.s });
      setShowModal(true);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch transcript based on mode
  const extractTranscript = async () => {
    setLoading(true);
    setError('');
    setShowModal(false);

    try {
      let payload = { ytLink: videoUrl, mode: 'full' };

      if (selectedMode === 'timeline') {
        const startSec = toSecondsFromClock(timelineClock, 'start');
        const endSec = toSecondsFromClock(timelineClock, 'end');

        if (endSec <= startSec) {
          throw new Error('Timeline end must be greater than start.');
        }

        payload = {
          ytLink: videoUrl,
          mode: 'custom',
          startSec,
          endSec,
        };
      }

      if (selectedMode === 'chapters') {
        const ranges = selectedChapterIndexes
          .map((idx) => videoInfo?.chapters?.[idx])
          .filter(Boolean)
          .map((chapter) => ({ startSec: chapter.startSec, endSec: chapter.endSec }));

        if (!ranges.length) {
          throw new Error('Select at least one chapter.');
        }

        payload = {
          ytLink: videoUrl,
          mode: 'selected',
          ranges,
        };
      }

      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setTranscript(data.transcript);
      setMessages([]);
      setSummary('');
      setQuizQuestions([]);
      setError('');
      setActiveTab('chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Send chat message
  const sendMessage = async () => {
    if (!userInput.trim() || !transcript) {
      setError('Please extract transcript first');
      return;
    }

    const userMessage = { role: 'user', content: userInput, id: Date.now() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setUserInput('');
    setChatLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer || 'No response generated.', id: Date.now() + 1 }]);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
    }
  };

  // Summarize transcript
  const summarizeTranscript = async () => {
    if (!transcript) {
      setError('Please extract transcript first');
      return;
    }

    setSummarizing(true);
    setError('');

    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, language: summaryLanguage }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to summarize');
      setSummary(data.summary || 'No summary generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSummarizing(false);
    }
  };

  // Generate quiz
  const generateQuiz = async () => {
    if (!transcript) {
      setError('Please extract transcript first');
      return;
    }

    setQuizLoading(true);
    setError('');

    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          questionCount: quizConfig.questionCount,
          language: quizConfig.language,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate quiz');

      setQuizQuestions(data.questions || []);
      setQuizAnswers({});
      setQuizSubmitted(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuizLoading(false);
    }
  };

  // Submit quiz
  const submitQuiz = () => {
    setQuizSubmitted(true);
  };

  const renderFormattedText = (text) => {
    if (!text) return null;

    return text.split('\n').map((line, lineIndex) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <div key={`line-${lineIndex}`}>
          {parts.map((part, partIndex) => {
            const isBold = part.startsWith('**') && part.endsWith('**');
            if (isBold) {
              return <strong key={`part-${lineIndex}-${partIndex}`}>{part.slice(2, -2)}</strong>;
            }
            return <span key={`part-${lineIndex}-${partIndex}`}>{part}</span>;
          })}
        </div>
      );
    });
  };

  const correctAnswersCount = quizQuestions.reduce((score, question, index) => {
    const correctOption = question?.options?.[question?.correctIndex];
    return quizAnswers[index] === correctOption ? score + 1 : score;
  }, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 glass navbar-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <div className="w-10 h-10 bg-primary text-primary-foreground rounded-lg flex items-center justify-center">
              <Youtube className="w-6 h-6" />
            </div>
            <span className="font-bold text-xl">YT Helper</span>
          </Link>
          
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium hover:text-primary transition">
              Back to Home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* URL Input Section */}
        <div className="glass p-6 rounded-xl mb-6 animate-fadeInUp">
          <label className="block font-semibold mb-3">YouTube Video URL</label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full bg-input pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={!!transcript}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !transcript) {
                    fetchVideoDetails();
                  }
                }}
              />
            </div>
            {!transcript ? (
              <button
                onClick={fetchVideoDetails}
                disabled={loading}
                className="btn-primary px-6 whitespace-nowrap flex items-center gap-2"
              >
                {loading ? <Loader className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                {loading ? 'Analyzing...' : 'Analyze Video'}
              </button>
            ) : (
              <button
                onClick={() => {
                  setTranscript('');
                  setVideoUrl('');
                  setVideoInfo(null);
                  setSummary('');
                  setMessages([]);
                  setQuizQuestions([]);
                  setActiveTab('chat');
                }}
                className="btn-secondary px-6 whitespace-nowrap flex items-center gap-2"
              >
                <Plus className="w-5 h-5 transform rotate-45" />
                New Video
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg mb-6 flex gap-2 items-center animate-fadeInUp">
            <span>Warning:</span>
            <span>{error}</span>
          </div>
        )}

        {/* Modal for Selection */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeInUp">
            <div className="glass max-w-2xl w-full mx-4 p-8 rounded-2xl max-h-[85vh] overflow-y-auto">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-3"><Clapperboard/> Select Extraction Mode</h3>
              {Number(videoInfo?.durationSec || 0) >= 3600 && (
                <div className="mb-5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  For long videos, please select required chapter(s) or timeline. Otherwise, extraction limit may be exceeded.
                </div>
              )}
              
              <div className="space-y-3 mb-8">
                {[
                  { value: 'full', label: 'Full Video', desc: 'Extract complete transcript' },
                  { value: 'timeline', label: 'Timeline', desc: 'Extract custom start and end range' },
                  { value: 'chapters', label: 'Chapters', desc: 'Extract one selected chapter range' }
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`glass p-4 rounded-lg cursor-pointer flex items-center gap-4 transition-all duration-300 ${
                      selectedMode === option.value ? 'ring-2 ring-primary' : 'hover:bg-secondary'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={option.value}
                      checked={selectedMode === option.value}
                      onChange={(e) => setSelectedMode(e.target.value)}
                      className="w-4 h-4 text-primary bg-gray-300 border-gray-400 focus:ring-primary"
                    />
                    <div className="flex-1">
                      <div className="font-semibold">{option.label}</div>
                      <div className="text-sm text-muted-foreground">{option.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {selectedMode === 'timeline' && (
                <div className="glass rounded-xl p-4 mb-6 animate-fadeInUp">
                  <h4 className="font-semibold mb-3">Custom Timeline</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Video duration: {videoInfo?.durationLabel || 'Unknown'}. Use hours : minutes : seconds.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-2">Start Time (hh:mm:ss)</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" min="0" placeholder="hh" value={timelineClock.startH} onChange={(e) => setTimelineClock((p) => ({ ...p, startH: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                        <input type="number" min="0" max="59" placeholder="mm" value={timelineClock.startM} onChange={(e) => setTimelineClock((p) => ({ ...p, startM: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                        <input type="number" min="0" max="59" placeholder="ss" value={timelineClock.startS} onChange={(e) => setTimelineClock((p) => ({ ...p, startS: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-2">End Time (hh:mm:ss)</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" min="0" placeholder="hh" value={timelineClock.endH} onChange={(e) => setTimelineClock((p) => ({ ...p, endH: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                        <input type="number" min="0" max="59" placeholder="mm" value={timelineClock.endM} onChange={(e) => setTimelineClock((p) => ({ ...p, endM: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                        <input type="number" min="0" max="59" placeholder="ss" value={timelineClock.endS} onChange={(e) => setTimelineClock((p) => ({ ...p, endS: e.target.value }))} className="w-full bg-input px-3 py-2 rounded-md" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedMode === 'chapters' && (
                <div className="glass rounded-xl p-4 mb-6 animate-fadeInUp">
                  <h4 className="font-semibold mb-3">Select Chapters</h4>
                  {videoInfo?.chapters?.length ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Choose one or more chapters ({selectedChapterIndexes.length} selected).</p>
                      <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                        {videoInfo.chapters.map((chapter, idx) => {
                          const checked = selectedChapterIndexes.includes(idx);
                          return (
                            <label key={`${chapter.title}-${idx}`} className="flex items-start gap-3 p-2 rounded-md hover:bg-secondary/40 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedChapterIndexes((prev) => {
                                    if (e.target.checked) return [...prev, idx];
                                    return prev.filter((item) => item !== idx);
                                  });
                                }}
                                className="mt-1"
                              />
                              <span className="text-sm">
                                {chapter.title} ({chapter.startSec}s - {chapter.endSec}s)
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      This video has no detected chapters. Use Full Video or Timeline mode.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={extractTranscript}
                  className="btn-primary flex-1"
                >
                  Extract Transcript
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Video Info */}
        {videoInfo && transcript && (
          <div className="glass p-6 rounded-xl mb-6 animate-fadeInUp">
            <h3 className="font-bold text-lg mb-3">{videoInfo.title}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Duration:</span>
                <div className="font-semibold">{videoInfo.durationLabel}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Channel:</span>
                <div className="font-semibold">{videoInfo.channelTitle}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Mode:</span>
                <div className="font-semibold capitalize">{selectedMode}</div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content - Tabs */}
        {transcript && (
          <div className="glass p-6 rounded-xl animate-fadeInUp">
            {/* Tabs Navigation */}
            <div className="flex gap-1 mb-6">
              {[
                { id: 'chat', label: 'Chat', icon: <Bot/> },
                { id: 'summarize', label: 'Summarize', icon: <BrainCircuit/> },
                { id: 'quiz', label: 'AI Quiz', icon: <TestTube/> }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 font-semibold border-b-2 -mb-px transition-colors duration-300 ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-primary'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Chat Tab */}
            {activeTab === 'chat' && (
              <div className="space-y-4 animate-fadeInUp">
                {/* Messages Area */}
                <div className="bg-secondary/50 rounded-lg p-4 min-h-96 max-h-96 overflow-y-auto flex flex-col gap-4">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Bot className="w-16 h-16 mb-4"/>
                      <p className="text-lg font-semibold">Start chatting with the AI</p>
                      <p>Ask anything about the video content.</p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' && <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0"><Bot className="w-5 h-5"/></div>}
                        <div
                          className={`p-3 rounded-lg max-w-[85%] border ${msg.role === 'user' ? 'bg-primary/90 text-primary-foreground border-primary/50 shadow-lg shadow-primary/20' : 'bg-muted border-white/10'}`}
                        >
                          {renderFormattedText(msg.content)}
                        </div>
                        {msg.role === 'user' && <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"><User className="w-5 h-5"/></div>}
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex items-center gap-2 self-start">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0"><Bot className="w-5 h-5"/></div>
                      <div className="p-3 rounded-lg bg-muted flex items-center gap-2">
                        <Loader className="animate-spin w-4 h-4" />
                        <span className="text-sm">AI is thinking...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      placeholder="Ask a question about the video..."
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !chatLoading) {
                          sendMessage();
                        }
                      }}
                      disabled={chatLoading}
                      className="w-full bg-input pl-4 pr-12 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button onClick={sendMessage} disabled={chatLoading} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-secondary">
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Summarize Tab */}
            {activeTab === 'summarize' && (
              <div className="animate-fadeInUp">
                <div className="glass rounded-xl p-4 mb-4 max-w-sm">
                  <label className="flex text-sm font-semibold text-muted-foreground mb-2 items-center gap-2">
                    <Languages className="w-4 h-4" /> Summary Language
                  </label>
                  <select
                    value={summaryLanguage}
                    onChange={(e) => setSummaryLanguage(e.target.value)}
                    className="w-full bg-input px-3 py-2 rounded-md"
                  >
                    <option value="english">English</option>
                    <option value="hindi">Hindi</option>
                  </select>
                </div>
                <button onClick={summarizeTranscript} disabled={summarizing} className="btn-primary mb-6 flex items-center gap-2">
                  {summarizing ? <Loader className="animate-spin w-5 h-5"/> : <Sparkles className="w-5 h-5"/>}
                  {summarizing ? 'Summarizing...' : 'Generate Summary'}
                </button>
                {summary && (
                  <div className="bg-secondary/50 rounded-lg p-6 prose prose-invert max-w-none">
                    <h3 className="font-bold text-lg mb-2">Summary</h3>
                    <div className="space-y-1">{renderFormattedText(summary)}</div>
                  </div>
                )}
              </div>
            )}

            {/* Quiz Tab */}
            {activeTab === 'quiz' && (
              <div className="animate-fadeInUp">
                <div className="glass rounded-xl p-4 mb-6">
                  <h4 className="font-semibold mb-3 flex items-center gap-2"><BrainCircuit/> Quiz Configuration</h4>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="flex text-sm font-semibold text-muted-foreground mb-2 items-center gap-2"><List/> Question Count</label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={quizConfig.questionCount}
                        onChange={(e) => setQuizConfig(prev => ({...prev, questionCount: Number(e.target.value)}))}
                        className="w-full bg-input px-3 py-2 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="flex text-sm font-semibold text-muted-foreground mb-2 items-center gap-2"><Languages/> Language</label>
                      <select
                        value={quizConfig.language}
                        onChange={(e) => setQuizConfig(prev => ({...prev, language: e.target.value}))}
                        className="w-full bg-input px-3 py-2 rounded-md"
                      >
                        <option value="english">English</option>
                        <option value="hindi">Hindi</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button onClick={generateQuiz} disabled={quizLoading} className="btn-primary mb-6 flex items-center gap-2">
                  {quizLoading ? <Loader className="animate-spin w-5 h-5"/> : <Sparkles className="w-5 h-5"/>}
                  {quizLoading ? 'Generating Quiz...' : 'Generate Quiz'}
                </button>

                {quizQuestions.length > 0 && (
                  <div className="space-y-6">
                    {quizSubmitted && (
                      <div className="glass p-4 rounded-lg border border-primary/40">
                        <p className="font-semibold text-lg">
                          Score: {correctAnswersCount} / {quizQuestions.length}
                        </p>
                      </div>
                    )}
                    {quizQuestions.map((q, qIndex) => (
                      <div key={qIndex} className="glass p-6 rounded-lg">
                        <p className="font-semibold mb-4">{qIndex + 1}. {q.question}</p>
                        <div className="space-y-2">
                          {q.options.map((option, oIndex) => (
                            <label
                              key={oIndex}
                              className={`block p-3 rounded-md cursor-pointer transition-colors ${
                                quizSubmitted
                                  ? option === q?.options?.[q?.correctIndex]
                                    ? 'bg-green-500/20 text-green-300 border-green-500'
                                    : quizAnswers[qIndex] === option
                                    ? 'bg-red-500/20 text-red-300 border-red-500'
                                    : 'bg-secondary/50'
                                  : 'bg-secondary/50 hover:bg-secondary'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`question-${qIndex}`}
                                value={option}
                                checked={quizAnswers[qIndex] === option}
                                onChange={() => setQuizAnswers(prev => ({...prev, [qIndex]: option}))}
                                disabled={quizSubmitted}
                                className="mr-3"
                              />
                              {option}
                            </label>
                          ))}
                        </div>
                        {quizSubmitted && (
                          <p className="mt-3 text-sm text-primary">
                            Correct answer: <strong>{q?.options?.[q?.correctIndex] || 'N/A'}</strong>
                          </p>
                        )}
                      </div>
                    ))}
                    {!quizSubmitted && (
                      <button onClick={submitQuiz} className="btn-primary w-full">Submit Quiz</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
