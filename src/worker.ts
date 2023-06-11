/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { postToMastodon } from './threadcount';

// Export a default object containing event handlers
export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(postToMastodon(env));
	},
};
