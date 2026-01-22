/**
 * Example configuration file
 * 
 * Copy this file to config.ts and fill in your actual values
 * config.ts is gitignored and will not be committed
 */

export const config = {
	// Telegram Configuration
	telegram: {
		botToken: 'YOUR_TELEGRAM_BOT_TOKEN_HERE',
		chatId: 'YOUR_TELEGRAM_CHAT_ID_HERE',
	},

	// AI Model Configuration
	ai: {
		classificationModel: '@cf/meta/llama-3.1-8b-instruct',
		embeddingModel: '@cf/baai/bge-m3',
		maxTokens: 300,
	},

	// Clustering Configuration
	clustering: {
		similarityThreshold: 0.86,
		embeddingDimension: 1024,
		clusterLookbackDays: 7,
	},

	// Priority Scoring Weights
	priority: {
		severityWeight: 0.55,
		frequencyWeight: 0.25,
		recencyWeight: 0.10,
		sentimentWeight: 0.10,
	},

	// Priority Score Thresholds
	priorityThresholds: {
		p0: 70,
		p1: 50,
		p2: 30,
	},

	// P0 Keywords for Instant Alert Detection
	p0Keywords: [
		'crash', 'won\'t open', 'stuck on launch', 'app broken', 'not working', 'completely broken',
		'can\'t login', 'locked out', 'otp not working', 'account locked', 'cannot access', 'login failed',
		'payment failed', 'charged twice', 'refund', 'subscription broken', 'billing error', 'payment error',
		'can\'t pay', 'payment not working', 'transaction failed',
		'data loss', 'deleted', 'missing data', 'security breach', 'hacked', 'pii leak', 'data breach',
		'privacy issue', 'unauthorized access',
		'production down', 'all users affected', 'complete outage', 'service down', 'system down'
	],

	// Digest Configuration
	digest: {
		maxIssues: 15,
		timezone: 'America/Los_Angeles',
	},

	// Cron Schedule
	cron: {
		schedule: '0 17 * * *',
	},
};

export function getConfig() {
	return {
		telegram: {
			botToken: (globalThis as any).TELEGRAM_BOT_TOKEN || config.telegram.botToken,
			chatId: (globalThis as any).TELEGRAM_CHAT_ID || config.telegram.chatId,
		},
		...config,
	};
}

