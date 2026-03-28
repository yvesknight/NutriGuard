import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase";

export async function seedData() {
  const foods = [
    { name: "Fufu", region: "Lagos, Nigeria", costTier: "low", nutritionalInfo: "High carbohydrate, energy dense", substitutes: ["Pounded Yam", "Garri"] },
    { name: "Jollof Rice", region: "Lagos, Nigeria", costTier: "medium", nutritionalInfo: "Carbohydrates, vitamins from tomatoes", substitutes: ["Fried Rice"] },
    { name: "Spinach (Efo)", region: "Lagos, Nigeria", costTier: "low", nutritionalInfo: "High iron, vitamins", substitutes: ["Kale", "Pumpkin leaves"] },
    { name: "Beans", region: "Lagos, Nigeria", costTier: "low", nutritionalInfo: "High protein, fiber", substitutes: ["Lentils"] },
    { name: "Plantain", region: "Lagos, Nigeria", costTier: "low", nutritionalInfo: "Potassium, vitamins", substitutes: ["Banana"] }
  ];

  for (const food of foods) {
    await addDoc(collection(db, "local_foods"), food);
  }

  const patients = [
    { healthWorkerId: "demo", name: "John Doe", age: 45, allergies: ["Peanuts"], conditions: ["Diabetes"], lastRecommendation: "" },
    { healthWorkerId: "demo", name: "Jane Smith", age: 30, allergies: [], conditions: ["Anemia"], lastRecommendation: "" }
  ];

  for (const patient of patients) {
    await addDoc(collection(db, "patients"), patient);
  }
}
