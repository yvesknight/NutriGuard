/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { 
  nutritionAdvisorAgent, 
  generateSpeech,
  generateVideo,
  generateHighQualityImage,
  connectLive,
  UserData,
  AgentResponse
} from './services/agents';
import { LiveServerMessage } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  ClipboardList, 
  Heart, 
  Home, 
  Info, 
  Loader2, 
  MapPin, 
  ShieldCheck, 
  User as UserIcon, 
  Utensils,
  Camera,
  ArrowRight,
  X,
  Mic,
  Volume2,
  Video,
  Play
} from 'lucide-react';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';

// --- Types ---
interface AppState {
  user: { uid: string; displayName: string; email: string; photoURL: string | null };
  profile: any | null;
  loading: boolean;
  activeTab: 'dashboard' | 'profile' | 'mealplan';
  agentsRunning: boolean;
  currentStep: string;
  finalPlan: any | null;
}

const PERSONAL_USER = {
  uid: 'personal-user',
  displayName: 'Personal User',
  email: 'personal@example.com',
  photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=personal'
};

export default function App() {
  const [state, setState] = useState<AppState>({
    user: PERSONAL_USER,
    profile: null,
    loading: true,
    activeTab: 'dashboard',
    agentsRunning: false,
    currentStep: '',
    finalPlan: null,
  });

  const [triageInput, setTriageInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  
  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  // High-Quality Image State
  const [hqImagePrompt, setHqImagePrompt] = useState('');
  const [hqImageSize, setHqImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [hqImageUrl, setHqImageUrl] = useState<string | null>(null);
  const [generatingHQImage, setGeneratingHQImage] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const authInitialized = useRef(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profileDoc = await getDoc(doc(db, 'users', PERSONAL_USER.uid));
        const profileData = profileDoc.exists() ? profileDoc.data() : null;
        setState(prev => ({ 
          ...prev, 
          profile: profileData, 
          loading: false 
        }));
      } catch (err) {
        console.error("Profile load error:", err);
        setState(prev => ({ ...prev, loading: false }));
        setError("Failed to load user profile. Please try refreshing.");
      } finally {
        authInitialized.current = true;
      }
    };
    loadProfile();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const profile = {
      uid: PERSONAL_USER.uid,
      email: PERSONAL_USER.email,
      age: Number(formData.get('age')),
      weight: Number(formData.get('weight')),
      conditions: formData.get('conditions')?.toString().split(',').map(s => s.trim()).filter(Boolean) || [],
      allergies: formData.get('allergies')?.toString().split(',').map(s => s.trim()).filter(Boolean) || [],
      location: formData.get('location')?.toString() || '',
      role: formData.get('role')?.toString() || 'user',
    };
    await setDoc(doc(db, 'users', PERSONAL_USER.uid), profile);
    setState(prev => ({ ...prev, profile, activeTab: 'dashboard' }));
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setTriageInput(prev => prev ? `${prev} ${transcript}` : transcript);
    };

    recognition.start();
  };

  const playSpeech = async (text: string) => {
    try {
      setIsPlaying(true);
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        // Sample rate is 24000 for Gemini TTS
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        audio.onended = () => setIsPlaying(false);
        await audio.play();
      } else {
        setIsPlaying(false);
      }
    } catch (err) {
      console.error("Speech playback failed", err);
      setIsPlaying(false);
      setError("Failed to generate speech.");
    }
  };

  const handleGenerateVideo = async (prompt: string) => {
    try {
      setGeneratingVideo(true);
      setError(null);

      // Check for API key
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }

      const apiKey = process.env.API_KEY || ""; 
      const url = await generateVideo(prompt, apiKey);
      if (url) {
        setVideoUrl(url);
      } else {
        setError("Failed to generate video.");
      }
    } catch (err: any) {
      console.error("Video generation failed", err);
      if (err.message?.includes("Requested entity was not found")) {
        await (window as any).aistudio.openSelectKey();
      }
      setError("Video generation failed. Please check your API key.");
    } finally {
      setGeneratingVideo(false);
    }
  };

  // --- Live API Handlers ---
  const toggleLiveSession = async () => {
    if (isLiveActive) {
      stopLiveSession();
      return;
    }
    startLiveSession();
  };

  const startLiveSession = async () => {
    try {
      setError(null);

      // Check for API key
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }
      const apiKey = process.env.API_KEY || "";

      setIsLiveActive(true);

      // Initialize Audio Context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // Setup Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(ctx.destination);

      processor.onaudioprocess = (e) => {
        if (!liveSessionRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert to PCM 16-bit
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        liveSessionRef.current.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      // Connect to Live API
      const session = await connectLive({
        onopen: () => console.log("Live session opened"),
        onmessage: async (message: LiveServerMessage) => {
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            const binary = atob(base64Audio);
            const pcm = new Int16Array(new Uint8Array(Array.from(binary, c => c.charCodeAt(0))).buffer);
            audioQueueRef.current.push(pcm);
            if (!isPlayingRef.current) playNextInQueue();
          }
          if (message.serverContent?.interrupted) {
            audioQueueRef.current = [];
            isPlayingRef.current = false;
          }
        },
        onerror: (err) => {
          console.error("Live API error", err);
          stopLiveSession();
        },
        onclose: () => {
          console.log("Live session closed");
          stopLiveSession();
        }
      }, "You are a helpful nutrition assistant. Talk to the user in a friendly and professional manner.", apiKey);

      liveSessionRef.current = session;
    } catch (err) {
      console.error("Failed to start live session", err);
      setError("Failed to access microphone or connect to Live API.");
      stopLiveSession();
    }
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const ctx = audioContextRef.current;
    const pcm = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, pcm.length, 16000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      channelData[i] = pcm[i] / 0x7FFF;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextInQueue();
    source.start();
  };

  // --- High-Quality Image Handlers ---
  const handleGenerateHQImage = async () => {
    if (!hqImagePrompt) return;
    try {
      setGeneratingHQImage(true);
      setError(null);

      // Check for API key
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }

      const apiKey = process.env.API_KEY || ""; 
      const url = await generateHighQualityImage(hqImagePrompt, hqImageSize, apiKey);
      if (url) {
        setHqImageUrl(url);
      } else {
        setError("Failed to generate high-quality image.");
      }
    } catch (err: any) {
      console.error("HQ Image generation failed", err);
      if (err.message?.includes("Requested entity was not found")) {
        await (window as any).aistudio.openSelectKey();
      }
      setError("HQ Image generation failed. Please check your API key.");
    } finally {
      setGeneratingHQImage(false);
    }
  };

  const runAnalysis = async () => {
    if (!state.profile) {
      setError("Please complete your profile first.");
      setState(prev => ({ ...prev, activeTab: 'profile' }));
      return;
    }

    setError(null);
    setState(prev => ({ 
      ...prev, 
      agentsRunning: true, 
      currentStep: 'Analyzing meal and profile...',
      finalPlan: null
    }));

    try {
      const result = await nutritionAdvisorAgent(triageInput, state.profile, imagePreview || undefined);
      
      // Save to Firestore
      await addDoc(collection(db, 'meal_plans'), {
        userId: state.user?.uid,
        createdAt: serverTimestamp(),
        plan: result.markdown_plan,
        summary: result.summary,
        safetyStatus: result.safety_status
      });

      setState(prev => ({ 
        ...prev, 
        agentsRunning: false, 
        finalPlan: result, 
        currentStep: 'Analysis Complete' 
      }));

    } catch (err) {
      console.error("Analysis failed", err);
      setError("The AI analysis failed. Please try a shorter request.");
      setState(prev => ({ ...prev, agentsRunning: false, currentStep: 'Error' }));
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  if (state.loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-orange-500 selection:text-black">
      {/* Sidebar Navigation */}
      <nav className="fixed left-0 top-0 h-full w-20 border-r border-zinc-800 bg-[#0d0d0d] flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center text-black font-bold text-xl mb-4">NG</div>
        
        <NavIcon active={state.activeTab === 'dashboard'} onClick={() => setState(p => ({...p, activeTab: 'dashboard'}))} icon={<Home />} label="Home" />
        <NavIcon active={state.activeTab === 'mealplan'} onClick={() => setState(p => ({...p, activeTab: 'mealplan'}))} icon={<Utensils />} label="Plans" />
        <NavIcon active={state.activeTab === 'profile'} onClick={() => setState(p => ({...p, activeTab: 'profile'}))} icon={<UserIcon />} label="Profile" />
      </nav>

      <main className="pl-20 min-h-screen">
        <header className="h-20 border-b border-zinc-800 flex items-center justify-between px-8 sticky top-0 bg-[#0a0a0a]/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-orange-500 uppercase tracking-widest">System Status: Online</span>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="flex items-center gap-4">
            {isLiveActive && (
              <div className="flex items-center gap-1 h-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [4, 16, 4] }}
                    transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                    className="w-1 bg-orange-500 rounded-full"
                  />
                ))}
              </div>
            )}
            <button 
              onClick={toggleLiveSession}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-widest",
                isLiveActive 
                  ? "bg-red-500 text-white animate-pulse" 
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              )}
            >
              <Mic className="w-4 h-4" />
              {isLiveActive ? 'Live Session Active' : 'Start Live Voice Chat'}
            </button>
            <span className="text-sm font-medium">{state.user.displayName}</span>
            <img src={state.user.photoURL || ''} className="w-8 h-8 rounded-full border border-zinc-700" alt="avatar" />
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-between"
            >
              <div className="flex items-center gap-3 text-red-500">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm font-medium">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
          <AnimatePresence mode="wait">
            {state.activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/10 rounded-lg">
                          <Activity className="w-6 h-6 text-orange-500" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight">New Analysis</h2>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="relative">
                          <textarea 
                            value={triageInput}
                            onChange={(e) => setTriageInput(e.target.value)}
                            placeholder="Describe your meal, symptoms, or ask for a plan... (e.g., 'I want a high-iron meal plan for lunch')"
                            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-zinc-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all resize-none font-mono text-sm"
                          />
                          <button 
                            onClick={startListening}
                            className={cn(
                              "absolute bottom-4 right-4 p-3 rounded-full transition-all",
                              isListening ? "bg-red-500 text-white animate-pulse" : "bg-zinc-800 text-zinc-400 hover:text-white"
                            )}
                          >
                            <Mic className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors text-sm font-medium"
                          >
                            <Camera className="w-4 h-4" />
                            {imagePreview ? 'Change Image' : 'Add Food Photo'}
                          </button>
                          <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleImageUpload} 
                            className="hidden" 
                            accept="image/*" 
                          />
                          {imagePreview && (
                            <div className="relative group">
                              <img src={imagePreview} className="w-12 h-12 rounded-lg object-cover border border-zinc-700" alt="preview" />
                              <button 
                                onClick={() => setImagePreview(null)}
                                className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        <button 
                          disabled={state.agentsRunning || !triageInput}
                          onClick={runAnalysis}
                          className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                        >
                          {state.agentsRunning ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Activity className="w-5 h-5" />
                              Get Nutrition Advice
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {state.agentsRunning && (
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 flex items-center justify-center gap-4">
                        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                        <span className="text-sm font-mono italic">{state.currentStep}</span>
                      </div>
                    )}

                    {state.finalPlan && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-500/10 rounded-lg">
                              <CheckCircle2 className="w-6 h-6 text-green-500" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight">Compiled Recommendation</h2>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => playSpeech(state.finalPlan.summary)}
                              disabled={isPlaying}
                              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-all disabled:opacity-50"
                              title="Listen to Summary"
                            >
                              {isPlaying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                            </button>
                            <button 
                              onClick={() => handleGenerateVideo(state.finalPlan.summary)}
                              disabled={generatingVideo}
                              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-all disabled:opacity-50"
                              title="Generate Video Demo"
                            >
                              {generatingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                            </button>
                            <div className={cn(
                              "px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest",
                              state.finalPlan.safety_status === 'BLOCKED' ? 'bg-red-500 text-white' : 'bg-green-500 text-black'
                            )}>
                              {state.finalPlan.safety_status}
                            </div>
                          </div>
                        </div>
                        
                        {videoUrl && (
                          <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-black aspect-video flex items-center justify-center">
                            <video src={videoUrl} controls className="w-full h-full" />
                          </div>
                        )}

                        <div className="prose prose-invert max-w-none prose-orange">
                          <ReactMarkdown>{state.finalPlan.markdown_plan}</ReactMarkdown>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  <div className="space-y-8">
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/10 rounded-lg">
                          <Camera className="w-5 h-5 text-orange-500" />
                        </div>
                        <h3 className="text-lg font-bold tracking-tight">HQ Image Generator</h3>
                      </div>
                      <div className="space-y-4">
                        <textarea 
                          value={hqImagePrompt}
                          onChange={(e) => setHqImagePrompt(e.target.value)}
                          placeholder="Describe the healthy meal image you want to generate..."
                          className="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-zinc-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all resize-none text-xs"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex gap-1">
                            {(["1K", "2K", "4K"] as const).map(size => (
                              <button
                                key={size}
                                onClick={() => setHqImageSize(size)}
                                className={cn(
                                  "px-2 py-1 rounded text-[10px] font-bold transition-all",
                                  hqImageSize === size ? "bg-orange-500 text-black" : "bg-zinc-800 text-zinc-400 hover:text-white"
                                )}
                              >
                                {size}
                              </button>
                            ))}
                          </div>
                          <button 
                            onClick={handleGenerateHQImage}
                            disabled={generatingHQImage || !hqImagePrompt}
                            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-black font-bold rounded-xl transition-all text-[10px] uppercase tracking-widest flex items-center gap-2"
                          >
                            {generatingHQImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Generate
                          </button>
                        </div>
                        {hqImageUrl && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="relative group rounded-xl overflow-hidden border border-zinc-800"
                          >
                            <img src={hqImageUrl} className="w-full aspect-square object-cover" alt="HQ Generated" />
                            <a 
                              href={hqImageUrl} 
                              download="hq-meal.png"
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-xs uppercase tracking-widest"
                            >
                              Download {hqImageSize}
                            </a>
                          </motion.div>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">User Profile</h3>
                      {!state.profile ? (
                        <div className="text-center py-4">
                          <p className="text-xs text-zinc-400 mb-4">Profile incomplete</p>
                          <button 
                            onClick={() => setState(p => ({...p, activeTab: 'profile'}))}
                            className="text-xs font-bold text-orange-500 hover:underline"
                          >
                            Complete Profile
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <ProfileItem label="Conditions" values={state.profile.conditions} icon={<Heart className="w-4 h-4" />} />
                          <ProfileItem label="Allergies" values={state.profile.allergies} icon={<AlertTriangle className="w-4 h-4 text-red-500" />} />
                          <ProfileItem label="Location" values={[state.profile.location]} icon={<MapPin className="w-4 h-4" />} />
                        </div>
                      )}
                    </div>

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">System Info</h3>
                      <div className="space-y-3">
                        <AgentNode name="Advisor Agent" model="Gemini 3.1 Pro" />
                        <AgentNode name="Storage" model="Firestore" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {state.activeTab === 'profile' && (
              <motion.div 
                key="profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-8">
                  <h2 className="text-3xl font-bold tracking-tight">Patient Profile</h2>
                  <form onSubmit={handleSaveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Age</label>
                      <input name="age" type="number" defaultValue={state.profile?.age} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Weight (kg)</label>
                      <input name="weight" type="number" defaultValue={state.profile?.weight} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Conditions (comma separated)</label>
                      <input name="conditions" defaultValue={state.profile?.conditions?.join(', ')} placeholder="Diabetes, Hypertension..." className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Allergies (comma separated)</label>
                      <input name="allergies" defaultValue={state.profile?.allergies?.join(', ')} placeholder="Peanuts, Shellfish..." className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Location (Region)</label>
                      <input name="location" defaultValue={state.profile?.location} placeholder="Lagos, Nigeria" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Account Role</label>
                      <select name="role" defaultValue={state.profile?.role || 'user'} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 focus:ring-2 focus:ring-orange-500 outline-none">
                        <option value="user">Patient / User</option>
                        <option value="health_worker">Community Health Worker</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 pt-4 flex flex-col gap-4">
                      <button type="submit" className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-black font-bold rounded-xl transition-all uppercase tracking-widest">
                        Save Profile
                      </button>
                      <button 
                        type="button"
                        onClick={async () => {
                          try {
                            const { seedData } = await import('./seed');
                            await seedData();
                            setError("Database seeded successfully!");
                          } catch (err) {
                            console.error("Seeding failed", err);
                            setError("Failed to seed database.");
                          }
                        }}
                        className="w-full py-2 border border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-600 rounded-xl transition-all text-xs uppercase tracking-widest"
                      >
                        Seed Demo Data (Local Foods & Patients)
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {state.activeTab === 'mealplan' && (
              <MealPlansView userId={state.user.uid} />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// --- Subcomponents ---

function NavIcon({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "relative group p-3 rounded-xl transition-all flex items-center justify-center",
        active ? "bg-orange-500 text-black" : "text-zinc-500 hover:text-white hover:bg-zinc-800"
      )}
    >
      <div className="w-6 h-6 flex items-center justify-center">
        {icon}
      </div>
      <span className="absolute left-full ml-4 px-2 py-1 bg-zinc-800 text-white text-[10px] uppercase tracking-widest rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        {label}
      </span>
    </button>
  );
}

function ProfileItem({ label, values, icon }: { label: string, values: string[], icon: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {values.length > 0 ? values.map(v => (
          <span key={v} className="text-xs bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">{v}</span>
        )) : <span className="text-xs text-zinc-600 italic">None</span>}
      </div>
    </div>
  );
}

function AgentNode({ name, model }: { name: string, model: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
      <span className="text-xs font-medium">{name}</span>
      <span className="text-[10px] font-mono text-orange-500/80">{model}</span>
    </div>
  );
}

function MealPlansView({ userId }: { userId: string }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlans = async () => {
      const q = query(collection(db, 'meal_plans'), where('userId', '==', userId));
      const snapshot = await getDocs(q);
      setPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    };
    fetchPlans();
  }, [userId]);

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-orange-500" /></div>;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <h2 className="text-3xl font-bold tracking-tight">Saved Meal Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {plans.map(plan => (
          <div key={plan.id} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-500">{new Date(plan.createdAt?.toDate()).toLocaleDateString()}</span>
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded",
                plan.status === 'APPROVED' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
              )}>
                {plan.status}
              </span>
            </div>
            <p className="text-sm text-zinc-300 line-clamp-3">{plan.summary}</p>
            <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">Safety Score: {plan.safetyScore}/100</span>
              <button className="text-xs font-bold text-orange-500 hover:underline">View Full Plan</button>
            </div>
          </div>
        ))}
        {plans.length === 0 && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-zinc-800 rounded-3xl">
            <ClipboardList className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No meal plans generated yet.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
