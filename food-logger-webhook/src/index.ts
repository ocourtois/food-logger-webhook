/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import OpenAI from 'openai';
import { google } from 'googleapis';

interface VoicenotesPayload {
	data: {
		id: string;
		title: string;
		transcript?: string;
		content?: string;
		type?: string;
	};
	event: string;
	timestamp: string;
}

interface Env {
	OPENAI_API_KEY_FOODLOGGER: string;
	GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
	GOOGLE_PRIVATE_KEY: string;
	GOOGLE_SPREADSHEET_ID: string;
}

interface FoodLogEntry {
	Date: string;
	Time: string;
	Food?: string;
	KeyIngredients?: string;
	Drinks?: string;
	BowelCount?: number | null;
	BristolForm?: number | null;
	BowelUrgency?: number | null;
	Pain?: string | null;
	Stress?: string | null;
	Sleep?: string | null;
	Comments?: string | null;
}

async function appendToGoogleSheets(entries: FoodLogEntry[], env: Env): Promise<void> {
	try {
		// Create JWT auth client using service account credentials
		const auth = new google.auth.JWT({
			email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Handle escaped newlines
			scopes: ['https://www.googleapis.com/auth/spreadsheets'],
		});

		// Initialize Google Sheets API
		const sheets = google.sheets({ version: 'v4', auth });

		// Convert entries to rows for Google Sheets
		const rows = entries.map(entry => [
			entry.Date,
			entry.Time,
			entry.Food || '',
			entry.KeyIngredients || '',
			entry.Drinks || '',
			entry.BowelCount || '',
			entry.BristolForm || '',
			entry.BowelUrgency || '',
			entry.Pain || '',
			entry.Stress || '',
			entry.Sleep || '',
			entry.Comments || ''
		]);

		// Append rows to the spreadsheet
		const response = await sheets.spreadsheets.values.append({
			spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
			range: 'Log!A:L', // Use the correct sheet name
			valueInputOption: 'USER_ENTERED',
			insertDataOption: 'INSERT_ROWS', // Always insert new rows
			requestBody: {
				values: rows
			}
		});

		console.log(`✅ Successfully appended ${rows.length} entries to Google Sheets`);
		console.log('Google Sheets response:', response.data);

	} catch (error) {
		console.error('❌ Error appending to Google Sheets:', error);
		throw new Error('Failed to append entries to Google Sheets');
	}
}

async function transformTranscriptWithAI(transcript: string, apiKey: string): Promise<string> {
	//console.log('API Key provided:', apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No');
	
	if (!apiKey) {
		throw new Error('API key is missing or empty');
	}

	// Get today's date in DD/MM/YYYY format
	const today = new Date();
	const todayFormatted = today.toLocaleDateString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});

	const client = new OpenAI({
		apiKey: apiKey,
	});

	try {
		const response = await client.responses.create({
			model: 'gpt-4o',
			instructions: `You are a food logging assistant. Transform the voice transcript into structured JSON data for food logging. Return only valid JSON array of food log entries, each entry matching the following fields: 

# Fields 
[
  {
    "Date": "DD/MM/YYYY",
    "Time": "HH:MM",
    "Food": "List of foods eaten, multiline with bullet points",
    "KeyIngredients": "List of ingredients, multiline with bullet points",
    "Drinks": "List of drinks consumed, multiline with bullet points",
    "BowelCount": "Number of bowel movements",
    "BristolForm": "Bristol stool form scale, range from 1 to 7",
    "BowelUrgency": "Urgency to defecate scale, range from 1 to 5",
    "Pain": "Any discomfort or pain experienced, can be null",
    "Stress": "Stress level or notes, can be null",
    "Sleep": "Sleep duration or quality, can be null",
    "Comments": "Additional observations or context, can be null"
  }
]

#Rules
- Usually a voice transcript will contain entries for 3 meals: breakfast, lunch, dinner 
- Unless times are specified in the transcript, assume breakfast is at 8:30, lunch at 12:15, dinner at 20:00
- Always create a separate json entry for each meal, up to 3 per day
- If one of the meal is absent from the transcript, **do not** create an entry
- If the voice transcript is not related to any food logging, return an empty json
- **Use today's date (${todayFormatted}) for all entries unless a different date is explicitly mentioned in the transcript**
`,
			input: `Transform this transcript into food log entries: "${transcript}"`,
		});

		return response.output_text || '{}';
	} catch (error) {
		console.error('OpenAI API Error:', error);
		throw new Error('Failed to transform transcript with AI');
	}
}

async function handleNoteCreated(data: VoicenotesPayload['data'], env: Env) {
	console.log('Note created:', data);
	console.log('Environment check:', {
		hasApiKey: !!env.OPENAI_API_KEY_FOODLOGGER,
		hasGoogleCreds: !!env.GOOGLE_SERVICE_ACCOUNT_EMAIL && !!env.GOOGLE_PRIVATE_KEY,
		hasSpreadsheetId: !!env.GOOGLE_SPREADSHEET_ID,
		envKeys: Object.keys(env)
	});
	
	if (data.transcript) {
		try {
			console.log('Voicenote received:', data);

			const transformedData = await transformTranscriptWithAI(data.transcript, env.OPENAI_API_KEY_FOODLOGGER);
			console.log('Raw transformed data:', transformedData);
			
			// Validate and process the JSON response
			try {
				// Clean the response by removing markdown code blocks if present
				let cleanedData = transformedData.trim();
				if (cleanedData.startsWith('```json')) {
					cleanedData = cleanedData.replace(/^```json\s*/, '').replace(/\s*```$/, '');
				} else if (cleanedData.startsWith('```')) {
					cleanedData = cleanedData.replace(/^```\s*/, '').replace(/\s*```$/, '');
				}
				
				const parsedData = JSON.parse(cleanedData);
				console.log('✅ Valid JSON received');
				
				let entries: FoodLogEntry[] = [];
				
				// Check if it's an array of entries
				if (Array.isArray(parsedData)) {
					console.log(`📋 Found ${parsedData.length} food log entries:`);
					entries = parsedData;
					parsedData.forEach((entry, index) => {
						console.log(`Entry ${index + 1}:`, {
							Date: entry.Date,
							Time: entry.Time,
							Food: entry.Food,
							KeyIngredients: entry.KeyIngredients,
							Drinks: entry.Drinks,
							BowelCount: entry.BowelCount,
							BristolForm: entry.BristolForm,
							BowelUrgency: entry.BowelUrgency,
							Pain: entry.Pain,
							Stress: entry.Stress,
							Sleep: entry.Sleep,
							Comments: entry.Comments
						});
					});
				} else if (parsedData && typeof parsedData === 'object' && parsedData.Date) {
					// Single entry object
					console.log('📋 Found 1 food log entry:');
					entries = [parsedData];
					console.log('Entry:', {
						Date: parsedData.Date,
						Time: parsedData.Time,
						Food: parsedData.Food,
						KeyIngredients: parsedData.KeyIngredients,
						Drinks: parsedData.Drinks,
						BowelCount: parsedData.BowelCount,
						BristolForm: parsedData.BristolForm,
						BowelUrgency: parsedData.BowelUrgency,
						Pain: parsedData.Pain,
						Stress: parsedData.Stress,
						Sleep: parsedData.Sleep,
						Comments: parsedData.Comments
					});
				} else {
					console.log('⚠️ Empty or invalid response format:', parsedData);
				}
				
				// Append entries to Google Sheets if we have any
				if (entries.length > 0) {
					console.log(`🔄 Appending ${entries.length} entries to Google Sheets...`);
					await appendToGoogleSheets(entries, env);
				} else {
					console.log('⚠️ No valid entries to append to Google Sheets');
				}
				
			} catch (jsonError) {
				console.error('❌ Invalid JSON response from OpenAI:', jsonError);
				console.error('Raw response:', transformedData);
			}
			
		} catch (error) {
			console.error('Error transforming transcript:', error);
		}
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Only accept POST requests
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		try {
			const payload = await request.json() as VoicenotesPayload;
			
			// Process different event types
			switch (payload.event) {
				case 'recording.created':
					await handleNoteCreated(payload.data, env);
					break;
			}

			return new Response('OK', { status: 200 });
		} catch (error) {
			console.error('Webhook error:', error);
			return new Response('Bad Request', { status: 400 });
		}
	},
} satisfies ExportedHandler<Env>;
