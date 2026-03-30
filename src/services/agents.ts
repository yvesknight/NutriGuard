import { GoogleGenAI, Type, Modality } from "@google/genai";
import { collection, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface UserData {
  age?: number;
  weight?: number;
  conditions: string[];
  allergies: string[];
  location: string;
}

export interface AgentResponse {
  agent_id: string;
  output: any;
  status: "APPROVED" | "BLOCKED" | "PENDING";
}

// Single Agent: Nutrition Advisor
export async function nutritionAdvisorAgent(userInput: string, userData: UserData, imageData?: string): Promise<any> {
  const parts: any[] = [
    { text: `User Request: ${userInput}` },
    { text: `User Profile: ${JSON.stringify(userData)}` }
  ];

  if (imageData) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageData.split(",")[1]
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: { parts },
    config: {
      systemInstruction: `You are an expert Nutrition Advisor. Your goal is to provide personalized dietary advice and meal information. 
      Consider the user's health conditions, allergies, and location if provided in their profile.
      If an image is provided, analyze the food shown and provide nutritional insights.
      Provide a comprehensive markdown plan and a short summary.
      Return JSON with 'markdown_plan', 'summary', and 'safety_status' (APPROVED or BLOCKED if dangerous).`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          markdown_plan: { type: Type.STRING },
          summary: { type: Type.STRING },
          safety_status: { type: Type.STRING }
        }
      }
    }
  });
  return JSON.parse(response.text);
}

// Agent 7: Speech Synthesis (TTS)
export async function generateSpeech(text: string): Promise<string | undefined> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say this clearly and helpfully: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}

// Agent 8: Video Generation (Veo)
export async function generateVideo(prompt: string, apiKey: string): Promise<string | undefined> {
  const veoAi = new GoogleGenAI({ apiKey });
  let operation = await veoAi.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `A helpful nutrition demonstration: ${prompt}`,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await veoAi.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) return undefined;

  const response = await fetch(downloadLink, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  });

  if (!response.ok) return undefined;
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
