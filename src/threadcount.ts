interface UserCount {
	total: number;
	mau: number;
}

interface StatHistory {
	date: string;
	users: UserCount;
}

const HISTORY_LENGTH = 336; // 2 weeks of hourly data
const INSTANCE = 'botsin.space';

function getClosestHistory(history: StatHistory[], targetDate: Date): StatHistory | null {
	if (history.length === 0) {
		return null;
	}

	return [...history].reduce((prev, curr) => {
		const currDate = new Date(curr.date);
		const prevDate = new Date(prev.date);

		const currDiff = Math.abs(currDate.getTime() - targetDate.getTime());
		const prevDiff = Math.abs(prevDate.getTime() - targetDate.getTime());

		return currDiff < prevDiff ? curr : prev;
	});
}

async function getStatsForSoftware(env: Env, software: string): Promise<StatHistory[]> {
	console.log('Fetching stats for ' + software);
	const response = await fetch(`https://api.fedidb.org/v1/software/${software.toLowerCase()}`);
	if (!response.ok) throw new Error('Failed to fetch stats for ' + software);
	const json = await response.json();
	const stats = {
		total: json.data.user_count || 0,
		mau: json.data.monthly_actives || 0,
	};
	const history = await handleHistory(env, software, stats);
	return history;
}

async function handleHistory({ KV }: Env, software: string, count: UserCount): Promise<StatHistory[]> {
	console.log('Handling history for ' + software);
	const historyRaw = await KV.get(software);
	let history: StatHistory[] = JSON.parse(historyRaw || '[]');
	history.push({ date: new Date().toISOString(), users: count });
	if (history.length > HISTORY_LENGTH) {
		history = history.slice(history.length - HISTORY_LENGTH);
	}
	await KV.put(software, JSON.stringify(history));
	return history;
}

async function generateChart(lemmyHistory: StatHistory[], kbinHistory: StatHistory[]) {
	console.log('Generating chart with ' + lemmyHistory.length + ' points');
	const labels = lemmyHistory.map((point) => point.date);
	const lemmyData = lemmyHistory.map((point) => point.users.total);
	const kbinData = kbinHistory.map((point) => point.users.total);

	const summedData = lemmyData.map((lemmyCount, i) => lemmyCount + kbinData[i]);

	const chart = {
		type: 'line',
		data: {
			labels: labels,
			datasets: [
				{
					data: summedData,
					fill: true,
					borderColor: '#32A467',
					backgroundColor: 'rgba(22, 90, 54, 0.4)',
				},
			],
		},
		options: {
			elements: {
				point: {
					radius: 0,
				},
			},
			legend: {
				display: false,
			},
			scales: {
				xAxes: [
					{
						display: true,
						type: 'time',
						ticks: {
							fontColor: 'white',
							stepSize: 1,
						},
						time: {
							unit: 'day',
						},
					},
				],
				yAxes: [
					{
						scaleLabel: {
							display: true,
							labelString: '# users',
							fontColor: 'white',
						},
						display: true,
						ticks: {
							fontColor: 'white',
							precision: 0,
						},
					},
				],
			},
		},
	};

	const url = `https://quickchart.io/chart?backgroundColor=${encodeURIComponent('#383E47')}&chart=${encodeURIComponent(
		JSON.stringify(chart)
	)}`;
	console.log('Chart URL:', url);
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to generate chart`);
	return { url, buffer: await response.arrayBuffer() };
}

async function uploadMedia(env: Env, buffer: ArrayBuffer, filename: string): Promise<string> {
	const endpoint = `https://${INSTANCE}/api/v2/media`;
	let formData = new FormData();
	formData.append('file', new Blob([buffer]), filename);
	formData.append('description', 'Chart showing Lemmy/kbin user count over time');

	const response = await fetch(endpoint, {
		method: 'POST',
		body: formData,
		headers: {
			Authorization: `Bearer ${env.MASTODON_TOKEN}`,
		},
	});
	if (!response.ok) {
		throw new Error('Failed to upload media: ' + (await response.text()));
	}

	const json = await response.json();
	return json.id;
}

export const updateStats = async (env: Env) => {
	console.log('Updating stats');
	await getStatsForSoftware(env, 'lemmy');
	await getStatsForSoftware(env, 'kbin');
};

export const updateStatsAndPost = async (env: Env) => {
	console.log('Updating stats and posting');
	const lemmyHistory = await getStatsForSoftware(env, 'lemmy');
	const kbinHistory = await getStatsForSoftware(env, 'kbin');
	const lemmy = lemmyHistory[lemmyHistory.length - 1].users;
	const kbin = kbinHistory[kbinHistory.length - 1].users;

	const totalSum = kbin.total + lemmy.total;
	let oneHourAgo = new Date();
	oneHourAgo.setHours(oneHourAgo.getTime() - 1000 * 60 * 60);
	const lemmyOneHourAgoStats = getClosestHistory(lemmyHistory, oneHourAgo)?.users.total || 0;
	const kbinOneHourAgoStats = getClosestHistory(kbinHistory, oneHourAgo)?.users.total || 0;
	const usersOneHourAgo = lemmyOneHourAgoStats + kbinOneHourAgoStats;
	console.log(`Total: ${totalSum}, 1h ago: ${usersOneHourAgo}`);
	const userDiff = totalSum - usersOneHourAgo;

	const mauSum = kbin.mau + lemmy.mau;

	const combinedChart = await generateChart(lemmyHistory, kbinHistory);
	const mediaID = await uploadMedia(env, combinedChart.buffer, 'combined.png');

	const endpoint = `https://${INSTANCE}/api/v1/statuses`;
	const payload = {
		status: `
${totalSum.toLocaleString()} Lemmy/kbin accounts
${userDiff > 0 ? '+' : ''}${userDiff.toLocaleString()} in the last hour
${mauSum.toLocaleString()} monthly active users
		`,
		media_ids: [mediaID],
		visibility: 'public',
	};
	console.log(payload);
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
