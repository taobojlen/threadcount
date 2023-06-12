interface UserCount {
	total: number;
	mau: number;
}

interface StatHistory {
	date: Date;
	users: UserCount;
}

const HISTORY_LENGTH = 336; // 2 weeks of hourly data
const INSTANCE = 'botsin.space';

async function getLinkAggregatorUserCounts(): Promise<{ lemmy: UserCount; kbin: UserCount }> {
	console.log('Fetching user counts...');
	const response = await fetch('https://api.fedidb.org/v1/software?limit=40');
	const json = await response.json();
	const lemmy = json.data.find((software) => software.name.toLowerCase() === 'lemmy');
	const kbin = json.data.find((software) => software.name.toLowerCase() === 'kbin');
	return {
		lemmy: {
			total: lemmy?.user_count || 0,
			mau: lemmy?.monthly_active_users || 0,
		},
		kbin: {
			total: kbin?.user_count || 0,
			mau: kbin?.monthly_active_users || 0,
		},
	};
}

async function handleHistory({ KV }: Env, software: string, count: UserCount): Promise<StatHistory[]> {
	console.log('Handling history for ' + software);
	const historyRaw = await KV.get(software);
	let history: StatHistory[] = JSON.parse(historyRaw || '[]');
	history.push({ date: new Date(), users: count });
	if (history.length > HISTORY_LENGTH) {
		history = history.slice(history.length - HISTORY_LENGTH);
	}
	await KV.put(software, JSON.stringify(history));
	return history;
}

function getUserDiff(history: StatHistory[], interval: number) {
	const today = history[history.length - 1].users;
	if (history.length < interval) return today.total;

	const past = history[history.length - 1 - interval].users;
	return today.total - past.total;
}

export const postToMastodon = async (env: Env) => {
	const { lemmy, kbin } = await getLinkAggregatorUserCounts();
	// Save to KV
	const lemmyHistory = await handleHistory(env, 'lemmy', lemmy);
	const kbinHistory = await handleHistory(env, 'kbin', kbin);

	const totalSum = kbin.total + lemmy.total;
	const oneHourAgo = getUserDiff(lemmyHistory, 1) + getUserDiff(kbinHistory, 1);
	const mauSum = kbin.mau + lemmy.mau;

	const endpoint = `https://${INSTANCE}/api/v1/statuses`;
	const payload = {
		status: `
${totalSum.toLocaleString()} Lemmy/kbin accounts
${oneHourAgo > 0 ? '+' : ''}${oneHourAgo.toLocaleString()} in the last hour
${mauSum.toLocaleString()} monthly active users
		`,
		media_ids: [],
		visibility: 'public',
	};
	console.log('Posting to Mastodon');
	await fetch(endpoint, {
		method: 'POST',
		body: JSON.stringify(payload),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.MASTODON_TOKEN}`,
		},
	});
};
