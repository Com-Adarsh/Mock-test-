import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are an expert exam formatter. Convert the following raw text from a PDF into a JSON array of questions.
      - Each question must have 'q', an array of 4 'options', and a 'correct' index (0-3).
      - Use the answer key usually found at the end of the text to determine the correct index.
      - Return ONLY the JSON array. Do not include markdown formatting.
      
      TEXT: ${text.substring(0, 15000)}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const textData = response.text();
    
    // Clean potential markdown from AI response
    const cleanJson = textData.replace(/```json|```/g, "").trim();
    return NextResponse.json(JSON.parse(cleanJson));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Parsing failed" }, { status: 500 });
  }
}
