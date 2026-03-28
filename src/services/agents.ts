import { GoogleGenAI, Type } from "@google/genai";
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

// Agent 1: Intake & Triage
export async function triageAgent(userInput: string): Promise<any> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userInput,
    config: {
      systemInstruction: "Classify user intent: 'meal_plan', 'allergy_check', 'symptom_advice', 'food_safety'. Extract structured data: age, weight, conditions (array), allergies (array), location. Return JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: { type: Type.STRING },
          data: {
            type: Type.OBJECT,
            properties: {
              age: { type: Type.NUMBER },
              weight: { type: Type.NUMBER },
              conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
              allergies: { type: Type.ARRAY, items: { type: Type.STRING } },
              location: { type: Type.STRING }
            }
          }
        }
      }
    }
  });
  return JSON.parse(response.text);
}

// Agent 2: Allergy Safety Agent
export async function allergySafetyAgent(ingredients: string[], userAllergies: string[], imageData?: string): Promise<AgentResponse> {
  const parts: any[] = [
    { text: `Check these ingredients: ${ingredients.join(", ")} against these allergies: ${userAllergies.join(", ")}.` }
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
    model: "gemini-3-flash-preview",
    contents: { parts },
    config: {
      systemInstruction: "You are a safety override agent. Detect allergens from text or images. Output safety_score (0-100), unsafe_ingredients (array), alternatives (array). If any allergen detected, status is 'BLOCKED', else 'APPROVED'. Return JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          safety_score: { type: Type.NUMBER },
          unsafe_ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
          status: { type: Type.STRING }
        }
      }
    }
  });

  const output = JSON.parse(response.text);
  return {
    agent_id: "allergy_safety_agent",
    output,
    status: output.status
  };
}

// Agent 3: Condition Specialist Agents
export async function conditionSpecialistAgent(condition: string, userData: UserData): Promise<any> {
  const prompts: Record<string, string> = {
    diabetes: "Focus on GI calculation, sugar alternatives, and meal timing.",
    anemia: "Focus on iron-rich combinations and absorption enhancers.",
    hypertension: "Focus on sodium limits and potassium-rich foods.",
    general: "Focus on balanced macros and deficiency detection."
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Condition: ${condition}. User Data: ${JSON.stringify(userData)}`,
    config: {
      systemInstruction: `You are a ${condition} specialist. ${prompts[condition] || prompts.general} Provide specific dietary recommendations in JSON format.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          key_nutrients: { type: Type.ARRAY, items: { type: Type.STRING } },
          avoid: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    }
  });
  return JSON.parse(response.text);
}

// Agent 4: Local Food Context Agent
export async function localFoodContextAgent(recommendations: string[], location: string): Promise<any> {
  // Query Firestore for local foods
  const q = query(collection(db, "local_foods"), where("region", "==", location));
  const snapshot = await getDocs(q);
  const localFoods = snapshot.docs.map(doc => doc.data());

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Recommendations: ${recommendations.join(". ")}. Location: ${location}. Local Database: ${JSON.stringify(localFoods)}`,
    config: {
      systemInstruction: "Map recommendations to locally available ingredients. Provide affordability tiers (low/medium/high). Suggest substitutions for unavailable items. Return JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          local_plan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING },
                cost_tier: { type: Type.STRING },
                local_alternative: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });
  return JSON.parse(response.text);
}

// Agent 5: Orchestrator Agent
export async function orchestratorAgent(triageData: any, specialistOutputs: any[], safetyOutput: AgentResponse, localContext: any): Promise<any> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Triage: ${JSON.stringify(triageData)}. Specialists: ${JSON.stringify(specialistOutputs)}. Safety: ${JSON.stringify(safetyOutput)}. Local: ${JSON.stringify(localContext)}`,
    config: {
      systemInstruction: "You are the Orchestrator. Compile a final personalized meal plan. Resolve conflicts (e.g., diabetes vs anemia). If safety status is BLOCKED, the plan must be a warning. Return a comprehensive markdown plan and a summary JSON.",
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

// Agent 6: Health Worker Interface Agent
export async function healthWorkerAgent(patients: any[]): Promise<any> {
  // Batch processing logic
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Batch patients: ${JSON.stringify(patients)}`,
    config: {
      systemInstruction: "Generate simplified batch recommendations for community health workers. Focus on actionable steps. Return JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            patient_name: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            priority: { type: Type.STRING }
          }
        }
      }
    }
  });
  return JSON.parse(response.text);
}
