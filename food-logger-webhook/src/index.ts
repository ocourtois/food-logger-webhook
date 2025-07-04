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

async function handleNoteCreated(data: VoicenotesPayload['data']) {
	console.log('Note created:', data);
	// TODO: Implement your food logging logic here
}

async function handleSummaryCreated(data: VoicenotesPayload['data']) {
	console.log('Summary created:', data);
	// TODO: Implement your summary processing logic here
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
					await handleNoteCreated(payload.data);
					break;
				case 'creation.summary':
					await handleSummaryCreated(payload.data);
					break;
				// Add other event handlers
			}

			return new Response('OK', { status: 200 });
		} catch (error) {
			return new Response('Bad Request', { status: 400 });
		}
	},
} satisfies ExportedHandler<Env>;
