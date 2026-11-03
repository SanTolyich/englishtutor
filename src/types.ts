export type TaskType = 'reading' | 'questions' | 'monologue' | 'listening';

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  content: string;
  instructions: string;
  plan?: string[];
  modelAnswer?: string;
  questions?: string[];
  listeningQuestions?: ListeningQuestion[];
  vocabulary?: Record<string, string>;
  characters?: Record<string, 'male' | 'female'>;
}

export interface ListeningQuestion {
  question: string;
  correctAnswer: string;
  type: 'true_false' | 'short_answer' | 'choice';
  options?: string[];
}

export interface Feedback {
  score: number;
  phonetics: string;
  grammar: string;
  taskCompletion: string;
  transcript: string;
  isCorrect?: boolean; // For listening
  explanation?: string; // For listening
}

export type AppState = 
  | 'idle' 
  | 'loading' 
  | 'task_ready' 
  | 'recording' 
  | 'processing' 
  | 'feedback' 
  | 'question_sequence' 
  | 'listening_playback' 
  | 'listening_question';

export type AppMode = 'speaking' | 'listening';
