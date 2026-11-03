/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  Square, 
  Play, 
  Pause, 
  RotateCcw, 
  ChevronRight, 
  BookOpen, 
  MessageSquare, 
  Mic2, 
  Volume2, 
  Settings,
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  Info,
  Headphones,
  Trophy,
  ArrowRight,
  HelpCircle,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { Task, TaskType, AppState, Feedback, AppMode, ListeningQuestion } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('listening');
  const [appState, setAppState] = useState<AppState>('idle');
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'training' | 'exam'>('training');
  const [history, setHistory] = useState<{ task: Task; feedback: Feedback }[]>([]);
  const [listeningHistory, setListeningHistory] = useState<{ task: Task; score: number; total: number }[]>([]);
  const [voiceType, setVoiceType] = useState<'male' | 'female' | 'child'>('female');
  const [textLength, setTextLength] = useState<'short' | 'long'>('short');
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioBufferSourceNode | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [lastAudioData, setLastAudioData] = useState<string | null>(null);

  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [audioProgress, setAudioProgress] = useState(1); // 0 to 1, default 1 (fully visible)
  const [currentListeningScore, setCurrentListeningScore] = useState(0);
  const [tasksCompletedSinceLastTest, setTasksCompletedSinceLastTest] = useState(0);
  const [isTestMode, setIsTestMode] = useState(false);
  const [testTasks, setTestTasks] = useState<Task[]>([]);
  const [testAnswers, setTestAnswers] = useState<string[][]>([]);
  const [silenceTimer, setSilenceTimer] = useState<NodeJS.Timeout | null>(null);
  const [overallAssessment, setOverallAssessment] = useState<{ summary: string; recommendations: string } | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    if ((appState === 'listening_question' || appState === 'question_sequence') && !isRecording && !feedback) {
      const timer = setTimeout(() => {
        setError("Попробуйте сказать: 'The answer is...' или 'I think it is...'");
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [appState, isRecording, feedback]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  // Recording logic
  const generateTask = async (type: TaskType) => {
    stopAudio();
    setAppState('loading');
    setError(null);
    setFeedback(null);
    setAudioUrl(null);
    setCurrentQuestionIdx(0);
    setQuestionAnswers([]);
    setCurrentListeningScore(0);

    if (type === 'listening') {
      return generateListeningTask();
    }

    const randomFactor = Math.random().toString(36).substring(7);

    try {
      const genderPrompt = voiceType === 'male' ? "The speaker is a male." : voiceType === 'child' ? "The speaker is a child." : "The speaker is a female.";
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `Generate a UNIQUE OGE English Speaking Task (Task ${type === 'reading' ? '1' : type === 'questions' ? '2' : '3'}). 
        Target Audience: Grade 9 Russian students (OGE Exam, CEFR A2/B1 level).
        
        VOCABULARY LEVEL: Use words common in Grades 7-9 Russian textbooks (Spotlight, Starlight). Avoid complex academic jargon. 
        Focus on these CURRICULUM TOPICS: [School life, Hobbies, Future career, Environment, Travel, Russian and British culture, Healthy lifestyle, Shopping, Technology].
        
        Randomness Seed: ${randomFactor}. Ensure the topic is DIFFERENT from common defaults.
        ${genderPrompt} If the speaker has a name, it MUST match this gender.
        Structure:
        - title: Short title in English
        - content: The task content (Use \n for line breaks. If dialogue, start each speaker's turn on a new line).
        - instructions: Instructions in English
        - plan: (Optional, for monologue) 4 bullet points for the plan
        - modelAnswer: (Optional) A perfect model answer for this task.
        - questions: (Optional, for Task 2) Exactly 6 direct questions related to a single topic.
        - vocabulary: (MANDATORY) A JSON object mapping exactly 10-15 key English words from the content (lowercased, no punctuation) to their Russian translations. Include both simple and "OGE-level" (challenging but fair) words.
        - characters: (MANDATORY for dialogues) A JSON object mapping speaker names to their gender ('male' or 'female').
        
        Return as JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              content: { type: Type.STRING },
              instructions: { type: Type.STRING },
              plan: { type: Type.ARRAY, items: { type: Type.STRING } },
              modelAnswer: { type: Type.STRING },
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
              vocabulary: { 
                type: Type.OBJECT, 
                description: "English words (lowercased) to Russian translations.",
                additionalProperties: { type: Type.STRING } 
              },
              characters: {
                type: Type.OBJECT,
                additionalProperties: { type: Type.STRING, enum: ['male', 'female'] }
              }
            },
            required: ["title", "content", "instructions", "vocabulary"]
          }
        }
      });

      const taskData = JSON.parse(response.text || '{}');
      const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        type,
        ...taskData
      };
      setCurrentTask(newTask);
      
      if (type === 'questions' && newTask.questions) {
        setAppState('question_sequence');
        // Automatically speak first question
        setTimeout(() => speakText(newTask.questions![0]), 1000);
      } else {
        setAppState('task_ready');
      }
    } catch (err) {
      console.error(err);
      setError("Не удалось сгенерировать задание. Проверьте подключение.");
      setAppState('idle');
    }
  };

  const generateListeningTask = async () => {
    const randomFactor = Math.random().toString(36).substring(7);
    const dateStr = new Date().toISOString();
    setShowTranscript(false);
    try {
      const genderPrompt = voiceType === 'male' ? "The speaker is a male." : voiceType === 'child' ? "The speaker is a child." : "The speaker is a female.";
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `Generate a COMPLETELY UNIQUE AND RANDOM OGE English Listening Task (A2-B1 level).
        Target Audience: Grade 9 students in Russia.
        
        VOCABULARY LEVEL: Align with Russian middle school textbooks (7-9 grade level). Use a mix of common day-to-day words and slightly more advanced OGE-relevant vocabulary.
        
        Randomness Seed: ${randomFactor}. Current Time: ${dateStr}.
        
        INSTRUCTION: Avoid repeating the same story. Choose from these themes RANDOMLY (or mix them): 
        [school exchange programs, part-time jobs for teens, environmental protection projects, family traditions, healthy eating habits, volunteering at an animal shelter, extreme weather experiences, local festivals, learning a new language, the pros and cons of social media].
        
        ${genderPrompt} If the speaker has a name, it MUST match this gender.
        
        CONSTRAINTS FOR DIALOGUE/TEXT:
        - If textLength is 'short': generate a dialogue between 2-3 characters.
        - Each character's turn MUST follow this format: "NAME: Text...\n"
        - Each speaker HAS NO MORE than 5 short sentences.
        - Total word count strictly between 80-120 words for short.
        
        Structure:
        - title: Short title in English
        - content: The full dialogue/text with \n line breaks between turns.
        - instructions: Instructions in English
        - vocabulary: (MANDATORY) A JSON object where keys are the EXACT words from the content (lowercased) and values are Russian translations. Pick 15-20 most useful/challenging words.
        - characters: (MANDATORY for dialogues) A JSON object mapping speaker names to their gender ('male' or 'female').
        - listeningQuestions: Array of ${textLength === 'short' ? '3' : '5-6'} questions.
          - question: The question text
          - options: Array of 3 options
          - correctAnswer: The correct option text
          - type: 'choice'
        
        Return as JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              content: { type: Type.STRING },
              instructions: { type: Type.STRING },
              vocabulary: { 
                type: Type.OBJECT, 
                description: "English words (lowercased, no punctuation) mapped to Russian translations.",
                additionalProperties: { type: Type.STRING } 
              },
              characters: {
                type: Type.OBJECT,
                additionalProperties: { type: Type.STRING, enum: ['male', 'female'] }
              },
              listeningQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ['choice'] }
                  },
                  required: ["question", "options", "correctAnswer", "type"]
                }
              }
            },
            required: ["title", "content", "instructions", "listeningQuestions", "vocabulary"]
          }
        }
      });

      const taskData = JSON.parse(response.text || '{}');
      const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'listening',
        ...taskData
      };
      setCurrentTask(newTask);
      setAppState('task_ready');
    } catch (err) {
      console.error(err);
      setError("Не удалось сгенерировать задание по аудированию.");
      setAppState('idle');
    }
  };

  const startListeningPlayback = async () => {
    if (!currentTask) return;
    const prevAppState = appState;
    setAppState('listening_playback');
    
    await speakText(currentTask.content, () => {
      // Transition to questions ONLY if we were in task_ready or listening_playback
      if (prevAppState === 'task_ready' || prevAppState === 'listening_playback') {
        setTimeout(() => {
          setAppState('listening_question');
          setCurrentQuestionIdx(0);
          speakText(currentTask.listeningQuestions![0].question);
        }, 1000);
      } else {
        setAppState(prevAppState);
      }
    });
  };

  // Recording logic
  const handleListeningAnswer = async (audioBlob: Blob) => {
    setAppState('processing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        const currentQuestion = currentTask?.listeningQuestions![currentQuestionIdx];

        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: [
            { inlineData: { mimeType: "audio/wav", data: base64Audio } },
            { text: `The user is answering a question based on an audio text.
              Question: ${currentQuestion?.question}
              Correct Answer: ${currentQuestion?.correctAnswer}
              
              Analyze if the user's spoken answer is semantically correct.
              Return as JSON:
              - isCorrect: boolean
              - transcript: string (what user said)
              - explanation: string (short feedback in Russian)`
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isCorrect: { type: Type.BOOLEAN },
                transcript: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["isCorrect", "transcript", "explanation"]
            }
          }
        });

        const result = JSON.parse(response.text || '{}');
        if (result.isCorrect) {
          setCurrentListeningScore(prev => prev + 1);
        }
        setFeedback({
          score: result.isCorrect ? 1 : 0,
          phonetics: "",
          grammar: "",
          taskCompletion: result.explanation,
          transcript: result.transcript,
          isCorrect: result.isCorrect,
          explanation: result.explanation
        });
        setAppState('feedback');
        if (window.innerWidth < 1024) {
          setIsSidebarOpen(true);
        }

        // Logic for next question or end of task
        const newAnswers = [...questionAnswers, result.transcript];
        setQuestionAnswers(newAnswers);
      };
    } catch (err) {
      console.error(err);
      setAppState('listening_question');
    }
  };

  const nextListeningQuestion = () => {
    if (currentQuestionIdx < (currentTask?.listeningQuestions?.length || 0) - 1) {
      const nextIdx = currentQuestionIdx + 1;
      setCurrentQuestionIdx(nextIdx);
      setFeedback(null);
      setAppState('listening_question');
      speakText(currentTask!.listeningQuestions![nextIdx].question);
    } else {
      // End of listening task
      if (currentTask) {
        setListeningHistory(prev => [...prev, { 
          task: currentTask, 
          score: currentListeningScore, 
          total: currentTask.listeningQuestions?.length || 0 
        }]);
      }
      setCurrentListeningScore(0);
      setTasksCompletedSinceLastTest(prev => prev + 1);
      setAppState('idle');
      setCurrentTask(null);
      setFeedback(null);
      
      // Check for periodic test
      if (tasksCompletedSinceLastTest + 1 >= 3) {
        startPeriodicTest();
      }
    }
  };

  const startPeriodicTest = async () => {
    setAppState('loading');
    setIsTestMode(true);
    setTasksCompletedSinceLastTest(0);
    setError("Внимание! Начинается мини-тест. Прослушайте фрагмент и ответьте на вопросы без подсказок.");
    setTimeout(() => generateTask('listening'), 3000);
  };

  const generateOverallAssessment = async () => {
    if (history.length === 0 && listeningHistory.length === 0) {
      setError("Недостаточно данных для оценки. Выполните несколько заданий.");
      return;
    }
    
    setIsAssessing(true);
    try {
      const historySummary = history.map(h => `Task: ${h.task.type}, Score: ${h.feedback.score}/3`).join('\n');
      const listeningSummary = listeningHistory.map(h => `Listening Task: ${h.task.title}, Score: ${h.score}/${h.total}`).join('\n');
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `Analyze the student's performance in OGE English preparation.
        Speaking History:
        ${historySummary}
        
        Listening History:
        ${listeningSummary}
        
        Provide:
        1. A summary of their current skills (Listening, Speaking, Grammar, Pronunciation) in Russian.
        2. Specific recommendations for improvement (e.g., "Practice more Task 2", "Focus on intonation").
        3. A motivational message.
        
        Return as JSON:
        - summary: string (Markdown supported)
        - recommendations: string (Markdown supported)`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              recommendations: { type: Type.STRING }
            },
            required: ["summary", "recommendations"]
          }
        }
      });
      
      const data = JSON.parse(response.text || '{}');
      setOverallAssessment(data);
    } catch (err) {
      console.error(err);
      setError("Не удалось сгенерировать оценку.");
    } finally {
      setIsAssessing(false);
    }
  };

  const handleOptionClick = (option: string) => {
    if (appState !== 'listening_question' || !currentTask) return;
    
    const currentQuestion = currentTask.listeningQuestions![currentQuestionIdx];
    const isCorrect = option === currentQuestion.correctAnswer;
    
    if (isCorrect) {
      setCurrentListeningScore(prev => prev + 1);
    }
    
    setFeedback({
      score: isCorrect ? 1 : 0,
      phonetics: "",
      grammar: "",
      taskCompletion: isCorrect ? "Верно!" : `Неверно. Правильный ответ: ${currentQuestion.correctAnswer}`,
      transcript: `Вы выбрали: ${option}`,
      isCorrect,
      explanation: isCorrect ? "Вы правильно поняли содержание текста." : `Правильный ответ был: ${currentQuestion.correctAnswer}. Попробуйте прослушать еще раз.`
    });
    setAppState('feedback');
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(true);
    }
    
    const newAnswers = [...questionAnswers, option];
    setQuestionAnswers(newAnswers);
  };
  const handleQuestionAnswer = async (audioBlob: Blob) => {
    // For Task 2, we collect answers and then analyze them all at once at the end
    // Or we can analyze them one by one. Let's analyze at the end for better flow.
    setAppState('processing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: [
            { inlineData: { mimeType: "audio/wav", data: base64Audio } },
            { text: "Transcribe this short answer." }
          ]
        });
        const transcript = response.text || "";
        
        // Check for voice commands in transcript
        if (transcript.toLowerCase().includes("next task")) {
          generateTask(currentTask?.type || 'reading');
          return;
        }
        if (transcript.toLowerCase().includes("repeat")) {
          if (currentTask?.questions) speakText(currentTask.questions[currentQuestionIdx]);
          setAppState('question_sequence');
          return;
        }

        const newAnswers = [...questionAnswers, transcript];
        setQuestionAnswers(newAnswers);

        if (currentQuestionIdx < (currentTask?.questions?.length || 0) - 1) {
          const nextIdx = currentQuestionIdx + 1;
          setCurrentQuestionIdx(nextIdx);
          setAppState('question_sequence');
          setTimeout(() => speakText(currentTask!.questions![nextIdx]), 1000);
        } else {
          // All questions answered, analyze all
          analyzeAllQuestions(newAnswers);
        }
      };
    } catch (err) {
      console.error(err);
      setAppState('question_sequence');
    }
  };

  const analyzeAllQuestions = async (answers: string[]) => {
    setAppState('processing');
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `Analyze these answers for OGE Task 2 (Questions).
        Questions: ${currentTask?.questions?.join(' | ')}
        Answers: ${answers.join(' | ')}
        
        Provide feedback in Russian.
        Criteria:
        - score: 0-6 (1 point per correct answer)
        - phonetics: Overall pronunciation.
        - grammar: Grammar/Vocab mistakes.
        - taskCompletion: Did they answer all questions correctly?
        - transcript: Combined transcript.
        
        Return as JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              phonetics: { type: Type.STRING },
              grammar: { type: Type.STRING },
              taskCompletion: { type: Type.STRING },
              transcript: { type: Type.STRING }
            },
            required: ["score", "phonetics", "grammar", "taskCompletion", "transcript"]
          }
        }
      });
      const feedbackData = JSON.parse(response.text || '{}');
      setFeedback(feedbackData);
      setAppState('feedback');
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(true);
      }
      if (currentTask) setHistory(prev => [{ task: currentTask, feedback: feedbackData }, ...prev]);
    } catch (err) {
      console.error(err);
      setAppState('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      setAppState('processing');
    }
  };

  // Speech analysis
  const analyzeSpeech = async (audioBlob: Blob) => {
    setAppState('processing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Audio
              }
            },
            {
              text: `Analyze this student's response for OGE English Speaking Task: ${currentTask?.title}.
              Task Type: ${currentTask?.type}.
              Task Content: ${currentTask?.content}.
              
              CRITICAL: Provide ALL feedback (phonetics, grammar, taskCompletion) EXCLUSIVELY in Russian. 
              Mention specific English words for examples, but the analysis text must be Russian.
              Criteria:
              - score: 0-3 (overall)
              - phonetics: Analysis of pronunciation and intonation.
              - grammar: Analysis of grammar and vocabulary.
              - taskCompletion: Did they cover all points/answer all questions?
              - transcript: Transcription of what they said.
              
              Return as JSON.`
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                phonetics: { type: Type.STRING },
                grammar: { type: Type.STRING },
                taskCompletion: { type: Type.STRING },
                transcript: { type: Type.STRING }
              },
              required: ["score", "phonetics", "grammar", "taskCompletion", "transcript"]
            }
          }
        });

        const feedbackData = JSON.parse(response.text || '{}');
        setFeedback(feedbackData);
        setAppState('feedback');
        if (window.innerWidth < 1024) {
          setIsSidebarOpen(true);
        }
        if (currentTask) {
          setHistory(prev => [{ task: currentTask, feedback: feedbackData }, ...prev]);
        }
      };
    } catch (err) {
      console.error(err);
      setError("Ошибка при анализе речи. Попробуйте еще раз.");
      setAppState('task_ready');
    }
  };

  // Text-to-speech for task/model answer
  const speakText = async (text: string, onComplete?: () => void) => {
    stopAudio();
    try {
      // If it's a dialogue, we might want to split it by lines and use different voices
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const voiceMap = {
        male: 'Charon',
        female: 'Kore',
        child: 'Fenrir'
      };

      if (lines.length > 1 && (text.includes(':') || currentTask?.characters)) {
        // Sequentially play each line
        const playNext = async (idx: number) => {
          if (idx >= lines.length) {
            if (onComplete) onComplete();
            return;
          }
          
          const line = lines[idx];
          const speakerMatch = line.match(/^([A-Z][a-z]+):/);
          const speakerName = speakerMatch ? speakerMatch[1] : null;
          let voiceName = voiceMap[voiceType];

          if (speakerName && currentTask?.characters?.[speakerName]) {
            voiceName = voiceMap[currentTask.characters[speakerName]];
          } else if (speakerName) {
            // Simple heuristic if not in mapping
            const femaleNames = ['Sarah', 'Mary', 'Jane', 'Elena', 'Anna', 'Mrs'];
            if (femaleNames.some(fn => speakerName.includes(fn))) voiceName = voiceMap.female;
            else voiceName = voiceMap.male;
          }

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: line }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          });

          const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            setLastAudioData(base64Audio);
            playRawPCM(base64Audio, 24000, () => playNext(idx + 1));
          } else {
            playNext(idx + 1);
          }
        };
        playNext(0);
      } else {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceMap[voiceType] },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          setLastAudioData(base64Audio);
          playRawPCM(base64Audio, 24000, onComplete);
        } else if (onComplete) {
          onComplete();
        }
      }
    } catch (err) {
      console.error("TTS Error:", err);
      setError("Ошибка при воспроизведении аудио. Попробуйте еще раз.");
      if (onComplete) onComplete();
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      const source = audioSourceRef.current;
      audioSourceRef.current = null; // Clear ref FIRST to prevent onended callback
      try {
        source.stop();
      } catch (e) {}
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    setAudioSource(null);
    setAudioContext(null);
    setIsAudioPaused(false);
    setAudioProgress(1);
  };

  const pauseAudio = () => {
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
      setIsAudioPaused(true);
    }
  };

  const resumeAudio = () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
      setIsAudioPaused(false);
    }
  };

  const restartAudio = () => {
    if (lastAudioData) {
      stopAudio();
      playRawPCM(lastAudioData);
    }
  };

  const playRawPCM = (base64Data: string, sampleRate: number = 24000, onComplete?: () => void) => {
    try {
      stopAudio(); // Ensure previous is dead
      
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Int16Array(len / 2);
      for (let i = 0; i < len; i += 2) {
        const low = binaryString.charCodeAt(i);
        const high = binaryString.charCodeAt(i + 1);
        bytes[i / 2] = (high << 8) | low;
      }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      setAudioContext(ctx);
      
      const audioBuffer = ctx.createBuffer(1, bytes.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < bytes.length; i++) {
        channelData[i] = bytes[i] / 32768;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = playbackSpeed;
      
      const duration = audioBuffer.duration / playbackSpeed;
      const startTime = ctx.currentTime;
      setAudioProgress(0);

      const updateProgress = () => {
        if (!audioSourceRef.current || audioSourceRef.current !== source) return;
        const elapsed = ctx.currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setAudioProgress(progress);
        if (progress < 1) {
          requestAnimationFrame(updateProgress);
        }
      };

      source.connect(ctx.destination);
      source.onended = () => {
        if (audioSourceRef.current === source) {
          audioSourceRef.current = null;
          setAudioSource(null);
          setIsAudioPaused(false);
          setAudioProgress(1); // Ensure it's full at the end
          if (onComplete) onComplete();
        }
      };
      source.start();
      requestAnimationFrame(updateProgress);
      audioSourceRef.current = source;
      setAudioSource(source);
    } catch (err) {
      console.error("Playback Error:", err);
      if (onComplete) onComplete();
    }
  };

  // Recording logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/ogg;codecs=opus';
        
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        
        if (appState === 'listening_question') {
          handleListeningAnswer(audioBlob);
        } else if (appState === 'question_sequence' && currentTask?.questions) {
          handleQuestionAnswer(audioBlob);
        } else if (mode === 'training') {
          analyzeSpeech(audioBlob);
        } else {
          setAppState('feedback');
          setFeedback({
            score: 0,
            phonetics: "Запись сохранена. В режиме экзамена детальный разбор не проводится.",
            grammar: "N/A",
            taskCompletion: "N/A",
            transcript: "Запись завершена."
          });
        }
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Recording Error:", err);
      setError("Доступ к микрофону запрещен или произошла ошибка. Пожалуйста, проверьте настройки.");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#f4f9f9] text-slate-800 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 lg:py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="bg-emerald-500 p-1.5 lg:p-2 rounded-lg">
            <BookOpen className="text-white w-5 h-5 lg:w-6 lg:h-6" />
          </div>
          <h1 className="text-base sm:text-lg lg:text-xl font-bold tracking-tight text-slate-900 truncate max-w-[120px] xs:max-w-[150px] sm:max-w-none">ОГЭ English Tutor</h1>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="flex lg:hidden items-center gap-2">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-slate-100 rounded-lg relative"
            title="История"
          >
            <History className="w-6 h-6 text-slate-600" />
            {history.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white"></span>
            )}
          </button>
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-slate-100 rounded-lg"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6 text-slate-600" /> : <Menu className="w-6 h-6 text-slate-600" />}
          </button>
        </div>

        {/* Desktop Navigation & Settings */}
        <div className="hidden lg:flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={() => {
                stopAudio();
                setAppMode('speaking');
                setAppState('idle');
                setCurrentTask(null);
              }}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                appMode === 'speaking' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Mic className="w-4 h-4" /> Говорение
            </button>
            <button 
              onClick={() => {
                stopAudio();
                setAppMode('listening');
                setAppState('idle');
                setCurrentTask(null);
              }}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                appMode === 'listening' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Headphones className="w-4 h-4" /> Аудирование
            </button>
          </div>

          <div className="flex items-center gap-3 border-l pl-6 border-slate-200">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Голос:</span>
              <select 
                value={voiceType} 
                onChange={(e) => setVoiceType(e.target.value as any)}
                className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              >
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
                <option value="child">Детский</option>
              </select>
            </div>

            <div className="flex items-center gap-2 border-l pl-3 border-slate-100">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Текст:</span>
              <select 
                value={textLength} 
                onChange={(e) => setTextLength(e.target.value as any)}
                className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              >
                <option value="short">Короткий</option>
                <option value="long">Длинный</option>
              </select>
            </div>

            <div className="flex items-center gap-2 border-l pl-3 border-slate-100">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Скорость:</span>
              <select 
                value={playbackSpeed} 
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1.0x</option>
                <option value={1.25}>1.25x</option>
              </select>
            </div>
            <button 
              onClick={() => {
                stopAudio();
                setAppState('idle');
                setCurrentTask(null);
                setFeedback(null);
                setIsTestMode(false);
              }}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              title="Сбросить"
            >
              <RotateCcw className="w-5 h-5 text-slate-500" />
            </button>

            <button
              onClick={generateOverallAssessment}
              disabled={isAssessing}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-md disabled:opacity-50"
            >
              {isAssessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
              Мой прогресс
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="lg:hidden fixed inset-x-0 top-[61px] bg-white border-b border-slate-200 z-30 shadow-xl p-4 space-y-4"
          >
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => {
                  stopAudio();
                  setAppMode('speaking');
                  setAppState('idle');
                  setCurrentTask(null);
                  setIsMobileMenuOpen(false);
                }}
                className={cn(
                  "px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  appMode === 'speaking' ? "bg-emerald-500 text-white shadow-md" : "bg-slate-100 text-slate-600"
                )}
              >
                <Mic className="w-4 h-4" /> Говорение
              </button>
              <button 
                onClick={() => {
                  stopAudio();
                  setAppMode('listening');
                  setAppState('idle');
                  setCurrentTask(null);
                  setIsMobileMenuOpen(false);
                }}
                className={cn(
                  "px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  appMode === 'listening' ? "bg-emerald-500 text-white shadow-md" : "bg-slate-100 text-slate-600"
                )}
              >
                <Headphones className="w-4 h-4" /> Аудирование
              </button>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-bold text-slate-600">Голос</span>
                </div>
                <select 
                  value={voiceType} 
                  onChange={(e) => setVoiceType(e.target.value as any)}
                  className="bg-transparent text-sm font-bold text-emerald-600 focus:outline-none"
                >
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="child">Детский</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <span className="text-sm font-bold text-slate-600">Длина текста</span>
                <select 
                  value={textLength} 
                  onChange={(e) => setTextLength(e.target.value as any)}
                  className="bg-transparent text-sm font-bold text-emerald-600 focus:outline-none"
                >
                  <option value="short">Короткий</option>
                  <option value="long">Длинный</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <span className="text-sm font-bold text-slate-600">Скорость</span>
                <select 
                  value={playbackSpeed} 
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="bg-transparent text-sm font-bold text-emerald-600 focus:outline-none"
                >
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button 
                onClick={() => {
                  stopAudio();
                  setAppState('idle');
                  setCurrentTask(null);
                  setFeedback(null);
                  setIsTestMode(false);
                  setIsMobileMenuOpen(false);
                }}
                className="flex items-center justify-center gap-2 bg-slate-100 text-slate-600 px-4 py-3 rounded-xl text-sm font-bold"
              >
                <RotateCcw className="w-4 h-4" /> Сбросить
              </button>
              <button
                onClick={() => {
                  generateOverallAssessment();
                  setIsMobileMenuOpen(false);
                }}
                disabled={isAssessing}
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-xl text-sm font-bold shadow-md disabled:opacity-50"
              >
                {isAssessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
                Прогресс
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 flex flex-col items-center">
          <div className="w-full max-w-3xl space-y-6 lg:space-y-8">
            
            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-medium">{error}</p>
                  <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
                    <Square className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Overall Assessment Modal */}
            <AnimatePresence>
              {overallAssessment && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[80vh]"
                  >
                    <div className="bg-emerald-600 p-4 lg:p-6 text-white flex items-center justify-between">
                      <div className="flex items-center gap-2 lg:gap-3">
                        <Trophy className="w-6 h-6 lg:w-8 lg:h-8" />
                        <h2 className="text-xl lg:text-2xl font-bold">Ваш прогресс</h2>
                      </div>
                      <button 
                        onClick={() => setOverallAssessment(null)}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    
                    <div className="p-4 lg:p-8 overflow-y-auto space-y-6 lg:space-y-8">
                      <section className="space-y-2 lg:space-y-3">
                        <h3 className="text-emerald-600 font-bold uppercase tracking-widest text-[10px] lg:text-xs">Анализ навыков</h3>
                        <div className="text-sm lg:text-base text-slate-700 leading-relaxed bg-slate-50 p-4 lg:p-6 rounded-2xl border border-slate-100">
                          <ReactMarkdown>{overallAssessment.summary}</ReactMarkdown>
                        </div>
                      </section>
                      
                      <section className="space-y-2 lg:space-y-3">
                        <h3 className="text-emerald-600 font-bold uppercase tracking-widest text-[10px] lg:text-xs">Рекомендации</h3>
                        <div className="text-sm lg:text-base text-slate-700 leading-relaxed bg-emerald-50 p-4 lg:p-6 rounded-2xl border border-emerald-100">
                          <ReactMarkdown>{overallAssessment.recommendations}</ReactMarkdown>
                        </div>
                      </section>
                    </div>
                    
                    <div className="p-4 lg:p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
                      <button
                        onClick={() => setOverallAssessment(null)}
                        className="w-full lg:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3 rounded-xl transition-all shadow-lg"
                      >
                        Понятно, продолжаем!
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mode: Speaking */}
            {appMode === 'speaking' && appState === 'idle' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12">
                <TaskTypeCard 
                  title="Задание 1" 
                  subtitle="Чтение текста" 
                  icon={<BookOpen className="w-8 h-8" />}
                  description="Чтение научно-популярного текста вслух. Оценивается фонетика и интонация."
                  onClick={() => generateTask('reading')}
                />
                <TaskTypeCard 
                  title="Задание 2" 
                  subtitle="Диалог-расспрос" 
                  icon={<MessageSquare className="w-8 h-8" />}
                  description="Ответы на 6 прямых вопросов. Оценивается грамматика и полнота ответа."
                  onClick={() => generateTask('questions')}
                />
                <TaskTypeCard 
                  title="Задание 3" 
                  subtitle="Монолог" 
                  icon={<Mic2 className="w-8 h-8" />}
                  description="Развернутое высказывание по теме с опорой на план. 1.5 минуты."
                  onClick={() => generateTask('monologue')}
                />
              </div>
            )}

            {/* Mode: Listening */}
            {appMode === 'listening' && appState === 'idle' && (
              <div className="flex flex-col items-center justify-center py-24 space-y-8">
                <div className="text-center space-y-4">
                  <div className="bg-emerald-100 text-emerald-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
                    <Headphones className="w-10 h-10" />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900">Практика аудирования</h2>
                  <p className="text-slate-500 max-w-md mx-auto">
                    Слушайте короткие диалоги и монологи на английском языке и отвечайте на вопросы голосом.
                  </p>
                </div>
                
                <button 
                  onClick={() => generateTask('listening')}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-10 py-4 rounded-2xl transition-all shadow-lg flex items-center gap-3 text-lg"
                >
                  <Play className="w-6 h-6 fill-white" /> Начать практику
                </button>

                {tasksCompletedSinceLastTest > 0 && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
                    <Trophy className="w-4 h-4" />
                    До следующего теста: {3 - tasksCompletedSinceLastTest} задания
                  </div>
                )}
              </div>
            )}

            {/* Loading State */}
            {appState === 'loading' && (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
                <p className="text-slate-500 font-medium animate-pulse">Генерирую задание для вас...</p>
              </div>
            )}

            {/* Task View */}
            {(appState === 'task_ready' || appState === 'recording' || appState === 'processing' || appState === 'feedback' || appState === 'question_sequence' || appState === 'listening_playback' || appState === 'listening_question') && currentTask && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl lg:rounded-3xl shadow-xl border border-slate-100 overflow-hidden w-full"
              >
                <div className="bg-slate-900 text-white px-4 lg:px-8 py-4 lg:py-6 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-emerald-400 text-[10px] lg:text-xs font-bold uppercase tracking-widest mb-0.5 lg:mb-1 block truncate">
                      {currentTask.type === 'reading' ? 'Задание 1: Чтение' : 
                       currentTask.type === 'questions' ? 'Задание 2: Вопросы' : 
                       currentTask.type === 'monologue' ? 'Задание 3: Монолог' : 'Аудирование'}
                    </span>
                    <h2 className="text-lg lg:text-2xl font-bold truncate">{currentTask.title}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentTask.type === 'listening' && (
                      <button
                        onClick={() => setShowTranscript(!showTranscript)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                          showTranscript ? "bg-white text-slate-900 border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                        )}
                      >
                        {showTranscript ? "Скрыть текст" : "Показать текст"}
                      </button>
                    )}
                    <button 
                      onClick={() => speakText(
                        appState === 'question_sequence' ? currentTask.questions![currentQuestionIdx] : 
                        appState === 'listening_question' ? currentTask.listeningQuestions![currentQuestionIdx].question :
                        currentTask.content
                      )}
                      className="bg-white/10 hover:bg-white/20 p-2 lg:p-3 rounded-full transition-colors flex-shrink-0"
                      title="Прослушать"
                    >
                      <Volume2 className="w-5 h-5 lg:w-6 lg:h-6" />
                    </button>
                  </div>
                </div>

                <div className="p-4 lg:p-8 space-y-4 lg:space-y-6">
                  <div className="bg-emerald-50 border border-emerald-100 p-3 lg:p-4 rounded-xl flex items-start gap-2 lg:gap-3">
                    <Info className="w-4 h-4 lg:w-5 lg:h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs lg:text-sm text-emerald-800 leading-relaxed italic">
                      {appState === 'question_sequence' ? "Слушайте вопрос и отвечайте. У вас есть 40 секунд на каждый ответ." : 
                       appState === 'listening_playback' ? "Слушайте внимательно. Текст прозвучит один раз." :
                       appState === 'listening_question' ? "Ответьте на вопрос голосом." :
                       currentTask.instructions}
                    </p>
                  </div>

                  {/* Active Task Interaction Area */}
                  {(appState === 'question_sequence' || appState === 'listening_playback' || appState === 'listening_question' || (appState === 'feedback' && currentTask.type === 'listening')) && (
                    <div className="mb-6">
                      {appState === 'question_sequence' ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-8">
                          <div className="flex items-center gap-4">
                            {currentTask.questions?.map((_, idx) => (
                              <div 
                                key={idx} 
                                className={cn(
                                  "w-3 h-3 rounded-full transition-all duration-500",
                                  idx === currentQuestionIdx ? "bg-emerald-500 scale-125 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : 
                                  idx < currentQuestionIdx ? "bg-emerald-200" : "bg-slate-200"
                                )}
                              />
                            ))}
                          </div>
                          
                          <div className="text-center space-y-2 lg:space-y-4">
                            <h3 className="text-slate-400 font-bold uppercase tracking-widest text-[10px] lg:text-xs">Вопрос {currentQuestionIdx + 1} из {currentTask.questions?.length}</h3>
                            <div className="text-xl lg:text-3xl font-bold text-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-700">
                              {currentTask.questions?.[currentQuestionIdx]}
                            </div>
                          </div>
                        </div>
                      ) : appState === 'listening_playback' ? (
                        <div className="flex flex-col items-center justify-center py-8 lg:py-12 space-y-6 lg:space-y-8">
                          {/* Transcript window moved above controls */}
                          {showTranscript && (
                            <div className="w-full font-mono text-sm lg:text-base leading-relaxed text-slate-700 bg-white p-4 lg:p-6 rounded-2xl border-2 border-emerald-100 shadow-inner max-h-[300px] overflow-y-auto mb-4 animate-in fade-in slide-in-from-top-2">
                              <TranslatableText 
                                text={currentTask.content} 
                                vocabulary={currentTask.vocabulary} 
                                progress={audioProgress}
                              />
                            </div>
                          )}

                          <div className="relative">
                            {!isAudioPaused && <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />}
                            <div className="bg-emerald-500 p-8 rounded-full relative">
                              <Volume2 className="w-12 h-12 text-white" />
                            </div>
                          </div>
                          
                          <div className="text-center space-y-2">
                            <p className="text-xl font-bold text-slate-700">Воспроизведение аудио...</p>
                            <p className="text-sm text-slate-400">Слушайте внимательно текст задания</p>
                          </div>

                          <div className="flex flex-wrap items-center justify-center gap-2 lg:gap-4">
                            <button
                              onClick={restartAudio}
                              className="p-3 lg:p-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl lg:rounded-2xl transition-all flex items-center gap-2 font-bold text-sm lg:text-base"
                              title="Сначала"
                            >
                              <RotateCcw className="w-4 h-4 lg:w-5 lg:h-5" /> Сначала
                            </button>
                            
                            {isAudioPaused ? (
                              <button
                                onClick={resumeAudio}
                                className="p-3 lg:p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl lg:rounded-2xl transition-all flex items-center gap-2 font-bold shadow-lg text-sm lg:text-base"
                              >
                                <Play className="w-4 h-4 lg:w-5 lg:h-5 fill-white" /> Продолжить
                              </button>
                            ) : (
                              <button
                                onClick={pauseAudio}
                                className="p-3 lg:p-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl lg:rounded-2xl transition-all flex items-center gap-2 font-bold shadow-lg text-sm lg:text-base"
                              >
                                <Pause className="w-4 h-4 lg:w-5 lg:h-5 fill-white" /> Пауза
                              </button>
                            )}

                            <button
                              onClick={stopAudio}
                              className="p-3 lg:p-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl lg:rounded-2xl transition-all flex items-center gap-2 font-bold text-sm lg:text-base"
                            >
                              <Square className="w-4 h-4 lg:w-5 lg:h-5 fill-red-600" /> Стоп
                            </button>
                          </div>
                        </div>
                      ) : appState === 'listening_question' ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-8">
                          <div className="flex items-center gap-4">
                            {currentTask.listeningQuestions?.map((_, idx) => (
                              <div 
                                key={idx} 
                                className={cn(
                                  "w-3 h-3 rounded-full transition-all duration-500",
                                  idx === currentQuestionIdx ? "bg-emerald-500 scale-125 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : 
                                  idx < currentQuestionIdx ? "bg-emerald-200" : "bg-slate-200"
                                )}
                              />
                            ))}
                          </div>
                          
                          <div className="text-center space-y-3 lg:space-y-4">
                            <h3 className="text-slate-400 font-bold uppercase tracking-widest text-[10px] lg:text-xs">Вопрос {currentQuestionIdx + 1} из {currentTask.listeningQuestions?.length}</h3>
                            <div className="text-lg lg:text-2xl font-bold text-slate-800">
                              {currentTask.listeningQuestions?.[currentQuestionIdx].question}
                            </div>
                            
                            {currentTask.listeningQuestions?.[currentQuestionIdx].options && (
                              <div className="grid grid-cols-1 gap-2 lg:gap-3 mt-4 lg:mt-6">
                                {currentTask.listeningQuestions[currentQuestionIdx].options.map((option, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => handleOptionClick(option)}
                                    className="bg-white border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 p-3 lg:p-4 rounded-xl text-left text-sm lg:text-base font-medium transition-all flex items-center gap-2 lg:gap-3 group"
                                  >
                                    <span className="w-6 h-6 lg:w-8 lg:h-8 bg-slate-100 group-hover:bg-emerald-100 text-slate-500 group-hover:text-emerald-600 rounded-full flex items-center justify-center font-bold text-xs lg:text-sm flex-shrink-0">
                                      {idx + 1}
                                    </span>
                                    {option}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="text-sm text-slate-400 italic mt-4">
                              Или ответьте голосом (нажмите на микрофон ниже)
                            </div>
                            
                            <button 
                              onClick={restartAudio}
                              className="mt-6 flex items-center gap-2 mx-auto text-emerald-600 hover:text-emerald-700 font-medium transition-colors bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100"
                            >
                              <RotateCcw className="w-4 h-4" /> Повторить основной текст
                            </button>

                            <div className="flex items-center justify-center gap-3 mt-4">
                              {isAudioPaused ? (
                                <button onClick={resumeAudio} className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 flex items-center gap-1">
                                  <Play className="w-3 h-3 fill-emerald-600" /> Продолжить
                                </button>
                              ) : (
                                <button onClick={pauseAudio} className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100 flex items-center gap-1">
                                  <Pause className="w-3 h-3 fill-amber-600" /> Пауза
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : appState === 'feedback' && currentTask.type === 'listening' ? (
                        <div className="flex flex-col items-center justify-center py-8 lg:py-12 space-y-6 lg:space-y-8 animate-in fade-in zoom-in duration-500">
                          <div className={cn(
                            "w-16 h-16 lg:w-20 lg:h-20 rounded-full flex items-center justify-center shadow-lg",
                            feedback?.isCorrect ? "bg-emerald-500" : "bg-red-500"
                          )}>
                            {feedback?.isCorrect ? <CheckCircle2 className="w-8 h-8 lg:w-10 lg:h-10 text-white" /> : <X className="w-8 h-8 lg:w-10 lg:h-10 text-white" />}
                          </div>
                          
                          <div className="text-center space-y-3 lg:space-y-4 max-w-md">
                            <h3 className={cn(
                              "text-xl lg:text-2xl font-bold",
                              feedback?.isCorrect ? "text-emerald-600" : "text-red-600"
                            )}>
                              {feedback?.isCorrect ? "Правильно!" : "Не совсем верно"}
                            </h3>
                            <p className="text-sm lg:text-base text-slate-600 leading-relaxed">
                              {feedback?.explanation}
                            </p>
                          </div>

                          <div className="w-full max-w-sm bg-slate-50 p-4 lg:p-6 rounded-2xl border border-slate-100 space-y-3">
                            <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
                              <span>Ваш ответ</span>
                              <span className={feedback?.isCorrect ? "text-emerald-500" : "text-red-500"}>
                                {feedback?.isCorrect ? "Верно" : "Ошибка"}
                              </span>
                            </div>
                            <p className="text-sm lg:text-base font-medium text-slate-800">
                              {feedback?.transcript}
                            </p>
                          </div>

                          <button 
                            onClick={nextListeningQuestion}
                            className="w-full max-w-sm bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 lg:py-4 rounded-xl lg:rounded-2xl transition-all shadow-md flex items-center justify-center gap-2 text-base lg:text-lg"
                          >
                            {currentQuestionIdx < (currentTask?.listeningQuestions?.length || 0) - 1 ? "Следующий вопрос" : "Завершить задание"} <ArrowRight className="w-5 h-5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Main Task Content display */}
                  {(!(appState === 'question_sequence' || appState === 'listening_playback' || appState === 'listening_question' || (appState === 'feedback' && currentTask.type === 'listening')) || (currentTask.type === 'listening' && showTranscript)) && (
                    <div className="font-mono text-sm lg:text-lg leading-relaxed text-slate-700 bg-slate-50 p-4 lg:p-6 rounded-2xl border border-slate-100 whitespace-pre-wrap">
                      {currentTask.type === 'listening' && !showTranscript ? (
                        "Текст скрыт для тренировки слуха. Используйте кнопку выше, чтобы увидеть его."
                      ) : (
                        <TranslatableText 
                          text={currentTask.content} 
                          vocabulary={currentTask.vocabulary} 
                          progress={appState === 'listening_playback' ? audioProgress : 1}
                        />
                      )}
                    </div>
                  )}

                  {currentTask.plan && appState !== 'question_sequence' && (
                    <div className="space-y-3">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <History className="w-4 h-4" /> План вашего ответа:
                      </h3>
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {currentTask.plan.map((item, idx) => (
                          <li key={idx} className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-100">
                            <span className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">
                              {idx + 1}
                            </span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Recording Controls */}
                <div className="bg-slate-50 border-t border-slate-100 p-6 lg:p-8 flex flex-col items-center gap-4 lg:gap-6">
                  {appState === 'processing' ? (
                    <div className="flex items-center gap-3 text-emerald-600 font-bold text-sm lg:text-base">
                      <Loader2 className="w-5 h-5 lg:w-6 lg:h-6 animate-spin" />
                      Анализирую ваш ответ...
                    </div>
                  ) : appState === 'feedback' ? (
                    <div className="text-sm text-slate-400 font-medium italic">
                      Результат анализа отображен выше
                    </div>
                  ) : appState === 'task_ready' && currentTask.type === 'listening' ? (
                    <button 
                      onClick={startListeningPlayback}
                      className="w-full lg:w-auto bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-8 lg:px-10 py-3 lg:py-4 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-3 text-base lg:text-lg"
                    >
                      <Play className="w-5 h-5 lg:w-6 lg:h-6 fill-white" /> Прослушать аудио
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-6 lg:gap-8">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={isRecording ? stopRecording : startRecording}
                          className={cn(
                            "w-16 h-16 lg:w-20 lg:h-20 rounded-full flex items-center justify-center transition-all shadow-lg",
                            isRecording ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"
                          )}
                        >
                          {isRecording ? (
                            <Square className="w-6 h-6 lg:w-8 lg:h-8 text-white fill-white" />
                          ) : (
                            <Mic className="w-6 h-6 lg:w-8 lg:h-8 text-white" />
                          )}
                        </motion.button>

                        {currentTask.modelAnswer && appMode === 'speaking' && (
                          <button 
                            onClick={() => speakText(currentTask.modelAnswer!)}
                            className="flex items-center gap-2 text-slate-600 hover:text-emerald-600 font-medium transition-colors"
                          >
                            <Volume2 className="w-5 h-5" />
                            Прослушать эталон
                          </button>
                        )}
                      </div>

                      {isRecording && (
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-3xl font-mono font-bold text-red-500">{formatTime(recordingTime)}</span>
                          <div className="flex gap-1">
                            {[...Array(5)].map((_, i) => (
                              <motion.div
                                key={i}
                                animate={{ height: [4, 16, 4] }}
                                transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                                className="w-1 bg-red-500 rounded-full"
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Sidebar: Feedback & History */}
        <AnimatePresence>
          {(isSidebarOpen || window.innerWidth >= 1024) && (
            <>
              {/* Mobile Backdrop */}
              {isSidebarOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsSidebarOpen(false)}
                  className="lg:hidden fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
                />
              )}
              
              <motion.aside 
                initial={window.innerWidth < 1024 ? { x: '100%' } : false}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className={cn(
                  "fixed lg:relative right-0 top-0 bottom-0 w-[85vw] sm:w-96 lg:w-96 bg-white border-l border-slate-200 flex flex-col shadow-2xl lg:shadow-none z-50 lg:z-20",
                  !isSidebarOpen && "hidden lg:flex"
                )}
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-500" />
                    Разбор и история
                  </h3>
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">
                        {history.length}
                      </span>
                    )}
                    <button 
                      onClick={() => setIsSidebarOpen(false)}
                      className="lg:hidden p-1 hover:bg-slate-100 rounded-md"
                    >
                      <X className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
                </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {feedback ? (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-400 uppercase tracking-widest">Ваш результат</div>
                  <div className="flex items-center gap-1">
                    {appMode === 'speaking' ? (
                      [...Array(3)].map((_, i) => (
                        <CheckCircle2 
                          key={i} 
                          className={cn("w-5 h-5", i < feedback.score ? "text-emerald-500" : "text-slate-200")} 
                        />
                      ))
                    ) : (
                      <div className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold",
                        feedback.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      )}>
                        {feedback.isCorrect ? "Верно!" : "Почти верно"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {currentTask && (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 space-y-2">
                      <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Текст задания</h4>
                      <p className="text-sm text-slate-700 leading-relaxed max-h-32 overflow-y-auto pr-2 custom-scrollbar whitespace-pre-wrap">
                        <TranslatableText text={currentTask.content} vocabulary={currentTask.vocabulary} progress={1} />
                      </p>
                      <button 
                        onClick={() => speakText(currentTask.content)}
                        className="flex items-center gap-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors bg-white/50 px-3 py-1.5 rounded-lg border border-emerald-200 w-full justify-center"
                      >
                        <Volume2 className="w-3 h-3" /> Прослушать еще раз
                      </button>
                    </div>
                  )}

                  {appMode === 'speaking' ? (
                    <>
                      <FeedbackItem title="Фонетика" content={feedback.phonetics} />
                      <FeedbackItem title="Грамматика" content={feedback.grammar} />
                      <FeedbackItem title="Выполнение задачи" content={feedback.taskCompletion} />
                    </>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Комментарий</h4>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {feedback.explanation}
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Транскрипция</h4>
                  <p className="text-sm text-slate-600 italic leading-relaxed">
                    "{feedback.transcript}"
                  </p>
                </div>

                {appMode === 'speaking' ? (
                  <button 
                    onClick={() => generateTask(currentTask?.type || 'reading')}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    Следующее задание <ChevronRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button 
                    onClick={nextListeningQuestion}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    {currentQuestionIdx < (currentTask?.listeningQuestions?.length || 0) - 1 ? "Следующий вопрос" : "Завершить задание"} <ArrowRight className="w-5 h-5" />
                  </button>
                )}
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                {appMode === 'speaking' ? <Mic className="w-12 h-12" /> : <Headphones className="w-12 h-12" />}
                <p className="text-sm font-medium">
                  {appMode === 'speaking' ? "Запишите свой ответ, чтобы получить детальный разбор ошибок" : "Прослушайте аудио и ответьте на вопросы"}
                </p>
              </div>
            )}

            {(history.length > 0 || listeningHistory.length > 0) && (
              <div className="pt-8 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Предыдущие попытки</h4>
                <div className="space-y-3">
                  {history.map((item, idx) => (
                    <div key={`speaking-${idx}`} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center justify-between group cursor-pointer hover:border-emerald-200 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-xs font-bold text-slate-400 group-hover:text-emerald-500">
                          {item.feedback.score}/3
                        </div>
                        <div className="text-xs">
                          <div className="font-bold text-slate-700 truncate max-w-[150px]">{item.task.title}</div>
                          <div className="text-slate-400 capitalize">{item.task.type}</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500" />
                    </div>
                  ))}
                  {listeningHistory.map((item, idx) => (
                    <div key={`listening-${idx}`} className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 flex items-center justify-between group cursor-pointer hover:border-emerald-300 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-xs font-bold text-emerald-500">
                          {item.score}/{item.total}
                        </div>
                        <div className="text-xs">
                          <div className="font-bold text-slate-700 truncate max-w-[150px]">{item.task.title}</div>
                          <div className="text-emerald-600">Аудирование</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-emerald-300 group-hover:text-emerald-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {history.length > 0 || listeningHistory.length > 0 ? (
              <div className="pt-8 border-t border-slate-100 mt-auto">
                <button
                  onClick={generateOverallAssessment}
                  disabled={isAssessing}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-3 group disabled:opacity-50"
                >
                  {isAssessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trophy className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />}
                  Полная оценка навыков
                </button>
              </div>
            ) : null}
          </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function TaskTypeCard({ title, subtitle, icon, description, onClick }: { 
  title: string; 
  subtitle: string; 
  icon: React.ReactNode; 
  description: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-white p-6 lg:p-8 rounded-2xl lg:rounded-3xl shadow-lg border border-slate-100 text-left flex flex-col items-start gap-3 lg:gap-4 transition-all hover:shadow-2xl hover:border-emerald-200 group"
    >
      <div className="bg-emerald-50 text-emerald-600 p-3 lg:p-4 rounded-xl lg:rounded-2xl group-hover:bg-emerald-500 group-hover:text-white transition-all">
        <div className="w-6 h-6 lg:w-8 lg:h-8 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div>
        <h3 className="text-[10px] lg:text-sm font-bold text-emerald-600 uppercase tracking-widest">{title}</h3>
        <h4 className="text-lg lg:text-xl font-bold text-slate-900">{subtitle}</h4>
      </div>
      <p className="text-xs lg:text-sm text-slate-500 leading-relaxed">
        {description}
      </p>
      <div className="mt-auto pt-2 lg:pt-4 flex items-center gap-2 text-emerald-600 font-bold text-xs lg:text-sm">
        Начать <ChevronRight className="w-4 h-4" />
      </div>
    </motion.button>
  );
}

function FeedbackItem({ title, content }: { title: string; content: string }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-widest">{title}</h4>
      <div className="text-sm text-slate-700 leading-relaxed">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function TranslatableText({ text, vocabulary, progress = 1 }: { 
  text: string; 
  vocabulary?: Record<string, string>;
  progress?: number;
}) {
  const [activeWordIdx, setActiveWordIdx] = useState<number | null>(null);

  if (!text) return null;

  // Split into lines first
  const lines = text.split('\n');
  
  // Calculate character limit based on progress
  const charLimit = Math.floor(text.length * progress);
  let currentCharCount = 0;

  return (
    <div className="space-y-4">
      {lines.map((line, lineIdx) => {
        // If the whole line is beyond the progress limit, don't show it
        if (currentCharCount >= charLimit && progress < 1) return null;
        
        // Split line into tokens
        const parts = line.split(/(\s+|\b)/);
        const lineContent = [];
        
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const partEnd = currentCharCount + part.length;
          
          // Truncate part if it's partially spoken
          let visiblePart = part;
          if (partEnd > charLimit && progress < 1) {
            visiblePart = part.substring(0, charLimit - currentCharCount);
          }
          
          if (visiblePart.length > 0) {
            // Robust cleaning for vocabulary matching
            const cleanWord = visiblePart.toLowerCase().trim().replace(/[.,!?;:()\[\]{}'"]/g, '');
            const translation = vocabulary ? vocabulary[cleanWord] : null;
            const uniqueIdx = lineIdx * 1000 + i;

            if (translation && cleanWord.length > 1) {
              lineContent.push(
                <span 
                  key={i} 
                  onClick={() => setActiveWordIdx(activeWordIdx === uniqueIdx ? null : uniqueIdx)}
                  className={cn(
                    "group relative inline-block cursor-pointer border-b border-dotted border-emerald-400 hover:text-emerald-700 transition-colors px-0.5 rounded",
                    activeWordIdx === uniqueIdx ? "bg-emerald-100 text-emerald-800" : ""
                  )}
                >
                  {visiblePart}
                  <span className={cn(
                    "pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 translate-y-2 opacity-0 transition-all bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow-xl whitespace-nowrap z-50",
                    activeWordIdx === uniqueIdx ? "opacity-100 translate-y-0" : "group-hover:opacity-100 group-hover:translate-y-0"
                  )}>
                    {translation}
                  </span>
                </span>
              );
            } else {
              lineContent.push(<span key={i}>{visiblePart}</span>);
            }
          }
          
          currentCharCount += part.length;
          if (currentCharCount >= charLimit && progress < 1) break;
        }
        
        // Add newline counting for the \n itself
        currentCharCount += 1; 

        return lineContent.length > 0 ? (
          <div key={lineIdx} className="min-h-[1.5em] animate-in fade-in slide-in-from-left-2 duration-300">
            {lineContent}
          </div>
        ) : null;
      })}
    </div>
  );
}
