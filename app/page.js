'use client';

import Link from 'next/link';
import { Youtube, Bot, BrainCircuit, TestTube, FileText, Settings } from 'lucide-react';

export default function HomePage() {
  const features = [
    {
      icon: <Bot className="w-8 h-8 text-primary" />,
      title: 'AI Chat',
      description: 'Ask focused questions from the video transcript and get direct answers.',
    },
    {
      icon: <BrainCircuit className="w-8 h-8 text-primary" />,
      title: 'Smart Summaries',
      description: 'Generate concise summary points for faster learning and revision.',
    },
    {
      icon: <TestTube className="w-8 h-8 text-primary" />,
      title: 'MCQ Quiz',
      description: 'Create Hindi or English quizzes with configurable question count.',
    },
    {
      icon: <Settings className="w-8 h-8 text-primary" />,
      title: 'Timeline and Chapters',
      description: 'Choose full, timeline, or chapter extraction from a popup flow.',
    },
    {
      icon: <FileText className="w-8 h-8 text-primary" />,
      title: 'Transcript Download',
      description: 'Open transcript tools quickly from the navigation menu.',
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 glass navbar-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Youtube className="w-6 h-6" />
            </div>
            <span className="text-xl font-bold">YT Video Helper</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link href="/tools/transcript-downloader" className="hidden sm:block text-sm font-medium hover:text-primary transition">Transcript Downloader</Link>
            <Link href="/ai-helper" className="btn-primary">AI Helper</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <section className="glass p-10 md:p-14 rounded-2xl text-center animate-fadeInUp">
          <h1 className="text-4xl md:text-6xl font-black leading-tight">
            Analyze YouTube Videos with AI
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-3xl mx-auto">
            Paste a video link, select an extraction mode, and then chat, summarize, or generate quiz questions from the transcript.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <Link href="/ai-helper" className="btn-primary text-base px-8 py-3">Open AI YT Video Helper</Link>
            <Link href="/tools/transcript-downloader" className="btn-secondary text-base px-8 py-3">Open Transcript Tool</Link>
          </div>
        </section>

        <section className="mt-20">
          <h2 className="text-3xl font-bold text-center mb-12">Features</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <article key={feature.title} className="glass p-8 rounded-xl text-center transform hover:-translate-y-2 transition-transform duration-300">
                <div className="inline-block p-4 bg-primary/10 rounded-full mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold">{feature.title}</h3>
                <p className="mt-3 text-muted-foreground">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-16 text-center text-xs text-muted-foreground/80 space-y-2">
          <p>
            Due to limited token resources, our platform can handle only 100 requests per day for AI Helper.
          </p>
          <p>Made by siddharth jain</p>
        </footer>
      </main>
    </div>
  );
}

