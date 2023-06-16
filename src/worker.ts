/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { updateStats, updateStatsAndPost } from './threadcount';

// Export a default object containing event handlers
export default {
	async scheduled(event, env, ctx) {
		// only post on the hour
		if (event.cron.startsWith('0 *')) {
			ctx.waitUntil(updateStatsAndPost(env));
		} else {
			// but fetch data every 30 mins
			ctx.waitUntil(updateStats(env));
		}
	},
};
