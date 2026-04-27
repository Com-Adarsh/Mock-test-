import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Extract exam questions from the text below. 
      - Identify the question text and 4 options.
      - Find the answer key at the end to determine the "correct" index (0 for A, 1 for B, etc.).
      - Return ONLY a valid JSON array of objects.
      
      Format: [{"q": "...", "options": ["...", "...", "...", "..."], "correct": 0}]
      
      TEXT: ${text.substring(0, 10000)} // Limiting text for safety
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const cleanJson = response.text().replace(/```json|```/g, "");
    
    return NextResponse.json(JSON.parse(cleanJson));
  } catch (error) {
    return NextResponse.json({ error: "Failed to parse PDF" }, { status: 500 });
  }
}
