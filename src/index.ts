/**
 * PM Daily Digest Agent - Ultimate Triage System
 * Instant alerts for P0 issues + Morning digest for everything else
 */

import { getConfig } from './config';

interface Feedback {
	id: string;
	content: string;
	source: 'support' | 'discord' | 'github' | 'email' | 'twitter';
	timestamp: number;
	user?: string;
	link?: string;
}

interface ClassificationResult {
	severity: 'P0' | 'P1' | 'P2' | 'P3';
	category: string;
	confidence: number;
	one_line_summary: string;
	reasoning: string;
}

interface Cluster {
	cluster_id: string;
	category: string;
	severity: string;
	centroid: number[]; // embedding vector
	count: number;
	first_seen: number;
	last_seen: number;
	representative_feedback_id: string;
	representative_feedback: string;
	summary: string;
	suggested_action: string;
	user_impact: string;
	priority_score: number;
	sentiment_score: number;
	top_sources: string[];
	// Fix tracking fields
	fix_status?: 'open' | 'fix_deployed' | 'resolved' | 'failed' | 'wont_fix';
	fix_deployed_date?: number;
	fix_deployed_version?: string;
	rollout_period_days?: number;
	original_severity?: string;
	current_severity?: string;
	reports_before_fix?: number;
	reports_after_fix?: number;
	fix_notes?: string;
}

interface PriorityIssue {
	priority_score: number;
	priority_level: string;
	cluster: Cluster;
}

interface Digest {
	digest_id: string;
	generated_at: number;
	top_issues: PriorityIssue[];
	individual_support?: PriorityIssue[]; // Single-user issues
	positive_feedback?: PriorityIssue[]; // Positive feedback
	summary: string;
}

// Config will be loaded per-request to get latest values

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			if (path === '/feedback' && method === 'POST') {
				return handlePostFeedback(request, env, corsHeaders);
			}
			if (path === '/seed' && method === 'POST') {
				return handleSeed(request, env, corsHeaders);
			}
			if (path === '/run' && method === 'POST') {
				return handleRun(request, env, corsHeaders);
			}
			if (path === '/digest' && method === 'GET') {
				return handleGetDigest(request, env, corsHeaders);
			}
			if (path === '/telegram/test' && method === 'POST') {
				return handleTestTelegram(request, env, corsHeaders);
			}
			if (path === '/telegram/debug' && method === 'GET') {
				return new Response(JSON.stringify({
					lastError: lastTelegramError || 'No errors recorded',
					note: 'This shows the last Telegram error. Run /run to see current error.'
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				});
			}
			if (path.startsWith('/clusters/') && path.endsWith('/mark-fixed') && method === 'POST') {
				const clusterId = path.split('/')[2];
				return handleMarkFixed(request, env, corsHeaders, clusterId);
			}
			if (path === '/reset' && method === 'POST') {
				return handleReset(request, env, corsHeaders);
			}
			if (path === '/view' && method === 'GET') {
				return handleViewDigest(request, env, corsHeaders);
			}
			if (path === '/' && method === 'GET') {
				return new Response(JSON.stringify({
					endpoints: {
						'POST /feedback': 'Submit a single feedback (triggers instant alert if P0)',
						'POST /seed': 'Load mock feedback data',
						'POST /run': 'Trigger morning digest generation',
						'GET /digest': 'Get latest digest (JSON)',
						'GET /view': 'View latest digest (same as Telegram, web browser)',
						'POST /telegram/test': 'Test Telegram connection',
						'POST /reset': 'Reset processed flags (for testing)'
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				});
			}

			return new Response('Not Found', { status: 404, headers: corsHeaders });
		} catch (error) {
			console.error('Error:', error);
			return new Response(JSON.stringify({ error: String(error) }), {
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			});
		}
	},

	scheduled(controller, env, ctx) {
		// Cron trigger - runs daily at 9am PT (17:00 UTC)
		console.log('Morning digest cron triggered at:', new Date().toISOString());
		generateMorningDigest(env).catch((err) => {
			console.error('Error in scheduled morning digest:', err);
		});
	}
} satisfies ExportedHandler<Env>;

async function handlePostFeedback(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const body = await request.json() as Feedback;
	
	const id = crypto.randomUUID();
	const timestamp = Date.now();
	
	// Store feedback
	await env.DB.prepare(
		'INSERT INTO feedback (id, content, source, timestamp, user, link, processed, instant_alert_sent) VALUES (?, ?, ?, ?, ?, ?, 0, 0)'
	).bind(id, body.content, body.source, timestamp, body.user || null, body.link || null).run();

	// Process feedback through triage system
	const shouldAlert = await triageFeedback(env, { ...body, id, timestamp });

	if (shouldAlert) {
		await sendInstantAlert(env, { ...body, id, timestamp });
	}

	return new Response(JSON.stringify({ 
		id, 
		message: 'Feedback received',
		instant_alert: shouldAlert ? 'sent' : 'queued for morning digest'
	}), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

async function handleSeed(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const mockFeedbacks: Omit<Feedback, "id" | "timestamp">[] = [
  // ======================
  // CUMULATIVE BUGS
  // ======================

  // P0: Crash on resume (Android) - keep all reports consistent
  {
    content:
      "P0 Crash on resume (Android, 100% repro). Steps: open app → navigate anywhere → press Home → open from Recents → splash appears for <1s → app force closes to home screen. Pixel 6, Android 14, app v3.2.1.",
    source: "support",
    user: "mobile_user1",
  },
  {
    content:
      "Crash when returning from background. Repro: open app → switch to Chrome for 5–10s → return via Recents → app closes instantly (no error dialog). Started after updating to v3.2.1. Samsung S23, Android 14.",
    source: "github",
    user: "mobile_dev",
  },
  {
    content:
      "Resume crash: if I lock/unlock and come back to the app, it crashes right after rendering the UI. Repro: open → power button (lock) → unlock → app shows UI briefly → force close.",
    source: "discord",
    user: "mobile_tester",
  },
  {
    content:
      "Multitasking triggers crash every time. Steps: open app → tap Home → open another app (WhatsApp) → return to app → crash to launcher. Can’t multitask at all on v3.2.1.",
    source: "support",
    user: "user_mobile",
  },
  {
    content:
      "CRITICAL: Android crash on resume affecting many users. App force closes when resumed from background/recents after v3.2.1 rollout. Users lose progress and restart from scratch.",
    source: "email",
    user: "admin@company.com",
  },
  {
    content:
      "Force close on resume: leave app for any reason → return → instant crash. I have to reopen app from scratch each time. Happens ~10/10 times.",
    source: "support",
    user: "frustrated_user",
  },
  {
    content:
      "App crashes on resume only (foreground usage is fine). Repro: open app → go to Settings app → return via Recents → crash. No crash dialog, just closes.",
    source: "github",
    user: "bug_reporter",
  },
  {
    content:
      "P0: resume crash. Users cannot switch apps without losing session. Repro: open → Home → Recents → crash immediately. Seen on multiple Android devices.",
    source: "support",
    user: "support_agent",
  },
  {
    content:
      "Crash signature: background → foreground transition triggers force close. Happens even when switching to camera/phone call and returning.",
    source: "discord",
    user: "community_mod",
  },

  // OPTIONAL: keep iOS but isolate it so it doesn’t pollute Android cluster
  // Uncomment if you want a separate iOS cluster
  /*
  {
    content:
      "[iOS? Possibly separate] Crash on resume: switch apps → return via app switcher → app closes. iPhone 14, iOS 17, app v3.2.1.",
    source: "github",
    user: "ios_user",
  },
  */

  // P2: Theme toggle broken (keep all reports as the SAME bug: toggle state changes but UI doesn’t apply)
  {
    content:
      "Theme toggle broken: Settings → Appearance → Dark Mode ON → toggle switches, but app stays light (no UI change). Persists after restart.",
    source: "support",
    user: "theme_user1",
  },
  {
    content:
      "Dark mode doesn’t apply. Steps: Settings → Display → enable Dark Mode → settings shows ON, but UI remains light. Reopening app doesn’t fix.",
    source: "github",
    user: "ui_reporter",
  },
  {
    content:
      "Theme switch fails: toggle animates but theme never changes. When I reopen Settings, it still shows Dark ON but app is light.",
    source: "discord",
    user: "theme_tester",
  },

  // P1: Double login required (keep the same signature, add “dashboard flash” consistently)
  {
    content:
      "Login requires 2 attempts. First login succeeds → dashboard flashes for ~0.5s → returns to login screen with no error. Second login works and stays logged in.",
    source: "support",
    user: "double_login_user1",
  },
  {
    content:
      "Double login bug: enter creds → Sign In → welcome toast appears → immediately redirected back to login. Second attempt succeeds. Started in v3.2.1.",
    source: "github",
    user: "double_login_dev",
  },
  {
    content:
      "Auth succeeds but session not retained on first attempt. Dashboard flashes then back to login. Second attempt keeps session. Very reproducible.",
    source: "discord",
    user: "double_login_tester",
  },
  {
    content:
      "First login attempt always kicks me out (back to login). Second attempt works. Looks like token/session write fails initially.",
    source: "email",
    user: "double_login_reporter",
  },

  // Docs outdated - keep concise and consistent
  {
    content:
      "Docs outdated: current API examples return 401/404 because endpoints/params changed. Need docs updated for latest API version.",
    source: "github",
    user: "contributor",
  },
  {
    content:
      "Documentation examples don’t work with latest API. Quickstart fails; curl commands return errors. Please update.",
    source: "discord",
    user: "dev_help",
  },

  // Mobile navigation UX - keep separate but crisp
  {
    content:
      "Mobile navigation is confusing: Settings is buried and hard to find. Took me 3 minutes to locate Appearance options.",
    source: "support",
    user: "mobile_user",
  },
  {
    content:
      "UX issue: navigation hierarchy unclear on mobile, especially for Settings + account options.",
    source: "twitter",
    user: "@mobile_dev",
  },

  // Feature request - keep as request, don’t mix with theme bug
  {
    content:
      "Feature request: add dark mode for the dashboard (not just settings screens). Bright UI at night is painful.",
    source: "discord",
    user: "community_member",
  },
  {
    content:
      "Would love a dashboard dark mode theme. Current dashboard is too bright at night.",
    source: "twitter",
    user: "@user_twitter",
  },

  // ======================
  // USER-SPECIFIC ISSUES (individual support)
  // ======================
  {
    content:
      "I am seeing wrong data in my account. My account shows incorrect transaction history from last month.",
    source: "email",
    user: "user_account_issue",
    link: "https://www.support.com/tickets/abc123",
  },
  {
    content:
      "I cannot access my account. My login credentials stopped working after I changed my email.",
    source: "support",
    user: "locked_user",
    link: "https://www.support.com/tickets/11111",
  },
  {
    content:
      "I am seeing incorrect data in my profile. My user ID is 789456 and the display name is wrong.",
    source: "support",
    user: "data_user",
    link: "https://www.support.com/tickets/22222",
  },
  {
    content:
      "My notifications are not working. I have them enabled but never receive any push notifications.",
    source: "email",
    user: "notification_user",
    link: "https://www.support.com/tickets/33333",
  },
  {
    content:
      "My saved preferences keep resetting. Every time I open the app, my settings are back to default.",
    source: "support",
    user: "settings_user",
    link: "https://www.support.com/tickets/44444",
  },
  {
    content:
      "I cannot upload my profile picture. The upload button does nothing when I tap it.",
    source: "discord",
    user: "upload_user",
    link: "https://www.discord.com/channels/support/55555",
  },
  {
    content:
      "My search history is showing searches I never made. Someone else might have access to my account.",
    source: "email",
    user: "security_concern_user",
    link: "https://www.support.com/tickets/66666",
  },
  {
    content:
      "The app keeps logging me out randomly. Happens 2-3 times per day, very frustrating.",
    source: "support",
    user: "logout_user",
    link: "https://www.support.com/tickets/77777",
  },

  // ======================
  // POSITIVE FEEDBACK
  // ======================
  {
    content: "Great product! Love the new features you added.",
    source: "twitter",
    user: "@happy_user",
    link: "https://www.twitter.com/company/status/1234567890",
  },
  {
    content: "Thanks for the quick fix on the last issue. Much appreciated!",
    source: "discord",
    user: "grateful_user",
    link: "https://www.discord.com/channels/123456789/987654321",
  },
  {
    content: "Performance has improved significantly. Good work team!",
    source: "github",
    user: "performance_tester",
    link: "https://www.github.com/company/repo/issues/42",
  },
];

	const timestamp = Date.now();
	const stmt = env.DB.prepare('INSERT INTO feedback (id, content, source, timestamp, user, link, processed, instant_alert_sent) VALUES (?, ?, ?, ?, ?, ?, 0, 0)');
	
	const seededItems: Array<{ id: string; user?: string; content: string }> = [];
	
	for (const feedback of mockFeedbacks) {
		const id = crypto.randomUUID();
		const feedbackTimestamp = timestamp - Math.random() * 86400000; // Random time in last 24h
		// Use the link provided in mockFeedbacks (or null if not provided)
		await stmt.bind(id, feedback.content, feedback.source, feedbackTimestamp, feedback.user || null, feedback.link || null).run();
		
		seededItems.push({
			id: id.substring(0, 8),
			user: feedback.user,
			content: feedback.content.substring(0, 60) + (feedback.content.length > 60 ? '...' : '')
		});
	}

	return new Response(JSON.stringify({ 
		message: `Seeded ${mockFeedbacks.length} feedback items`,
		items: seededItems
	}), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

async function handleRun(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	try {
		const result = await generateMorningDigest(env);
		return new Response(JSON.stringify({ 
			message: 'Morning digest generation triggered',
			details: result
		}), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Error generating digest:', error);
		return new Response(JSON.stringify({ 
			error: String(error),
			message: 'Failed to generate digest'
		}), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}
}

async function handleGetDigest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const result = await env.DB.prepare(
		'SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1'
	).first<{ digest_id: string; generated_at: number; top_issues: string; summary: string }>();

	if (!result) {
		return new Response(JSON.stringify({ message: 'No digest found. Run /run to generate one.' }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}

	// Parse the stored JSON
	const digestData = JSON.parse(result.top_issues);
	
	// Clean up clusters - remove internal-only fields
	const cleanCluster = (cluster: any) => {
		const cleaned = { ...cluster };
		delete cleaned.centroid; // Remove embedding vector (1024 numbers)
		delete cleaned.representative_feedback_id; // Internal reference
		return cleaned;
	};

	// Clean top issues
	const cleanedTopIssues = digestData.top_issues?.map((issue: any) => ({
		priority_score: issue.priority_score,
		priority_level: issue.priority_level,
		cluster: cleanCluster(issue.cluster)
	})) || [];

	// Clean individual support
	const cleanedIndividualSupport = digestData.individual_support?.map((issue: any) => ({
		priority_score: issue.priority_score,
		priority_level: issue.priority_level,
		cluster: cleanCluster(issue.cluster)
	})) || [];

	// Clean positive feedback
	const cleanedPositiveFeedback = digestData.positive_feedback?.map((issue: any) => ({
		priority_score: issue.priority_score,
		priority_level: issue.priority_level,
		cluster: cleanCluster(issue.cluster)
	})) || [];

	const cleanedDigest = {
		digest_id: result.digest_id,
		generated_at: result.generated_at,
		top_issues: cleanedTopIssues,
		individual_support: cleanedIndividualSupport,
		positive_feedback: cleanedPositiveFeedback,
		summary: result.summary
	};

	return new Response(JSON.stringify(cleanedDigest, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

async function handleViewDigest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	// Get latest digest from DB
	const result = await env.DB.prepare(
		'SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1'
	).first<{ digest_id: string; generated_at: number; top_issues: string; summary: string }>();

	if (!result) {
		const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>PM Daily Digest</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #1a1a2e; color: #eee; }
		.card { background: #16213e; padding: 30px; border-radius: 8px; }
		code { background: #0f3460; padding: 2px 6px; border-radius: 4px; }
		a { color: #e94560; }
	</style>
</head>
<body>
	<div class="card">
		<h1>📋 PM Daily Digest</h1>
		<p>No digest found. Run <code>POST /run</code> to generate one.</p>
		<p><a href="/">← Back to API</a></p>
	</div>
</body>
</html>`;
		return new Response(html, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
	}

	// Reconstruct Digest object from stored data
	const digestData = JSON.parse(result.top_issues);
	const digest: Digest = {
		digest_id: result.digest_id,
		generated_at: result.generated_at,
		top_issues: digestData.top_issues || [],
		individual_support: digestData.individual_support || [],
		positive_feedback: digestData.positive_feedback || [],
		summary: result.summary
	};

	// Get the exact same formatted message as Telegram
	const telegramMessage = await formatMorningDigest(env, digest);

	// Wrap in simple HTML page
	const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>PM Daily Digest</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			max-width: 700px;
			margin: 0 auto;
			padding: 20px;
			background: #1a1a2e;
			color: #eee;
			line-height: 1.6;
		}
		.container {
			background: #16213e;
			padding: 25px;
			border-radius: 8px;
			white-space: pre-wrap;
			word-wrap: break-word;
		}
		a { color: #e94560; }
		.refresh { 
			display: inline-block;
			margin: 15px 0;
			padding: 8px 16px;
			background: #e94560;
			color: white;
			text-decoration: none;
			border-radius: 4px;
		}
		.refresh:hover { background: #c73e54; }
		.footer {
			margin-top: 20px;
			padding-top: 15px;
			border-top: 1px solid #333;
			font-size: 0.9em;
			color: #888;
		}
		.footer a { color: #e94560; margin-right: 15px; }
	</style>
</head>
<body>
	<a href="/view" class="refresh">🔄 Refresh</a>
	<div class="container">${telegramMessage}</div>
	<div class="footer">
		<a href="/digest">View as JSON</a>
		<a href="/">API Endpoints</a>
	</div>
</body>
</html>`;

	return new Response(html, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleTestTelegram(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const message = '🧪 Test message from PM Daily Digest Agent';
	const success = await sendTelegramMessage(env, message);
	
	return new Response(JSON.stringify({ 
		success, 
		message: success ? 'Telegram message sent successfully' : 'Failed to send Telegram message'
	}), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

async function handleMarkFixed(
	request: Request,
	env: Env,
	corsHeaders: Record<string, string>,
	clusterId: string
): Promise<Response> {
	try {
		const body = await request.json() as {
			deployed_version?: string;
			rollout_days?: number;
			notes?: string;
		};
		
		// Get current cluster to save original severity
		const cluster = await env.DB.prepare(
			'SELECT severity, count FROM clusters WHERE cluster_id = ?'
		).bind(clusterId).first<{ severity: string; count: number }>();
		
		if (!cluster) {
			return new Response(JSON.stringify({ error: 'Cluster not found' }), {
				status: 404,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			});
		}
		
		// Downgrade priority: P0→P2, P1→P3, P2→P3, P3→P3
		const downgradeMap: Record<string, string> = {
			'P0': 'P2',
			'P1': 'P3',
			'P2': 'P3',
			'P3': 'P3'
		};
		const currentSeverity = downgradeMap[cluster.severity] || 'P2';
		
		// Update cluster with fix tracking
		await env.DB.prepare(
			`UPDATE clusters SET 
				fix_status = 'fix_deployed',
				fix_deployed_date = ?,
				fix_deployed_version = ?,
				rollout_period_days = ?,
				original_severity = ?,
				current_severity = ?,
				reports_before_fix = ?,
				reports_after_fix = 0,
				fix_notes = ?
			WHERE cluster_id = ?`
		).bind(
			Date.now(),
			body.deployed_version || null,
			body.rollout_days || 7,
			cluster.severity,
			currentSeverity,
			cluster.count,
			body.notes || null,
			clusterId
		).run();
		
		return new Response(JSON.stringify({
			message: 'Cluster marked as fixed',
			cluster_id: clusterId,
			original_severity: cluster.severity,
			current_severity: currentSeverity,
			note: `Priority downgraded from ${cluster.severity} to ${currentSeverity}. Monitoring for ${body.rollout_days || 7} days.`
		}), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: String(error) }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}
}

async function handleReset(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	// Complete reset - delete everything for a fresh start
	await env.DB.prepare('DELETE FROM cluster_members').run();
	await env.DB.prepare('DELETE FROM clusters').run();
	await env.DB.prepare('DELETE FROM instant_alerts').run();
	await env.DB.prepare('DELETE FROM digests').run();
	await env.DB.prepare('DELETE FROM feedback').run();
	
	return new Response(JSON.stringify({ 
		message: 'Complete reset - all data cleared. Ready for fresh /seed',
		note: 'All feedbacks, clusters, alerts, and digests have been deleted'
	}), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

// ==================== TRIAGE SYSTEM ====================

async function triageFeedback(env: Env, feedback: Feedback & { id: string; timestamp: number }): Promise<boolean> {
	// Layer 1: Hard Rule Triggers
	const hasP0Keyword = checkP0Keywords(feedback.content);
	
	if (hasP0Keyword) {
		await env.DB.prepare(
			'UPDATE feedback SET classification_severity = ?, classification_confidence = 1.0 WHERE id = ?'
		).bind('P0', feedback.id).run();
		return true; // Instant alert
	}

	// Layer 2: AI Classification
	const classification = await classifyFeedback(env, feedback.content);
	
	await env.DB.prepare(
		'UPDATE feedback SET classification_severity = ?, classification_confidence = ? WHERE id = ?'
	).bind(classification.severity, classification.confidence, feedback.id).run();

	// Route decision: P0 or high-confidence P1 → instant alert
	if (classification.severity === 'P0' || 
		(classification.severity === 'P1' && classification.confidence >= 0.7)) {
		return true; // Instant alert
	}

	// Everything else goes to morning digest
	return false;
}

function checkP0Keywords(content: string): boolean {
	const config = getConfig();
	const lowerContent = content.toLowerCase();
	const matchedKeywords = config.p0Keywords.filter(keyword => 
		lowerContent.includes(keyword.toLowerCase())
	);
	
	if (matchedKeywords.length > 0) {
		console.log(`🚨 P0 keywords matched: ${matchedKeywords.join(', ')}`);
		return true;
	}
	return false;
}

async function classifyFeedback(env: Env, content: string): Promise<ClassificationResult> {
	console.log('🤖 Classifying feedback:', content.substring(0, 100));
	
	// Rule-based pre-classification
	const lowerContent = content.toLowerCase();
	
	let quickCategory = 'other';
	let quickSeverity: 'P0' | 'P1' | 'P2' | 'P3' = 'P2';
	
	// Category detection
	if (lowerContent.includes('crash') || lowerContent.includes('won\'t open') || lowerContent.includes('stuck')) {
		quickCategory = 'crash';
		quickSeverity = 'P0';
	} else if (lowerContent.includes('login') || lowerContent.includes('sign in') || lowerContent.includes('otp')) {
		quickCategory = 'login';
		quickSeverity = lowerContent.includes('critical') || lowerContent.includes('urgent') ? 'P0' : 'P1';
	} else if (lowerContent.includes('payment') || lowerContent.includes('billing') || lowerContent.includes('charged') || lowerContent.includes('subscription')) {
		quickCategory = 'payment';
		quickSeverity = 'P1';
	} else if (lowerContent.includes('slow') || lowerContent.includes('lag') || lowerContent.includes('performance')) {
		quickCategory = 'performance';
		quickSeverity = 'P2';
	} else if (lowerContent.includes('dark mode') || lowerContent.includes('ui') || lowerContent.includes('ux') || lowerContent.includes('navigation')) {
		quickCategory = 'ui';
		quickSeverity = 'P3';
	} else if (lowerContent.includes('feature request') || lowerContent.includes('would love') || lowerContent.includes('add')) {
		quickCategory = 'feature_request';
		quickSeverity = 'P3';
	} else if (lowerContent.includes('error') || lowerContent.includes('bug') || lowerContent.includes('broken')) {
		quickCategory = 'bug';
		quickSeverity = 'P2';
	} else if (lowerContent.includes('rate limit') || lowerContent.includes('429')) {
		quickCategory = 'performance';
		quickSeverity = 'P2';
	} else if (lowerContent.includes('docs') || lowerContent.includes('documentation')) {
		quickCategory = 'other';
		quickSeverity = 'P3';
	}
	
	console.log(`🎯 Quick classification: ${quickCategory} / ${quickSeverity}`);
	
	// Simplified AI prompt
	const simplePrompt = `Classify this user feedback into a category and severity.

Feedback: "${content}"

Return ONLY this exact JSON format:
{"category":"${quickCategory}","severity":"${quickSeverity}","confidence":0.8,"one_line_summary":"brief summary"}

Categories: crash, login, payment, performance, ui, feature_request, bug, other
Severities: P0 (critical), P1 (major), P2 (minor), P3 (nice-to-have)`;

	try {
		const config = getConfig();
		const model = config.ai.classificationModel as keyof AiModels;
		const response = await env.AI.run(model, {
			messages: [
				{ role: 'user', content: simplePrompt }
			],
			max_tokens: 150,
			temperature: 0.1
		});

		let text = "";
		if (typeof response === "string") {
			text = response;
		} else if (response && typeof (response as any).response === "string") {
			text = (response as any).response;
		} else {
			text = JSON.stringify(response);
		}

		console.log('🤖 AI response:', text.substring(0, 200));

		const jsonMatch = text.match(/\{[\s\S]*?\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			console.log('✅ Parsed classification:', parsed);
			return {
				severity: parsed.severity || quickSeverity,
				category: parsed.category || quickCategory,
				confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.8)),
				one_line_summary: parsed.one_line_summary || content.substring(0, 100),
				reasoning: `AI: ${parsed.category} / ${parsed.severity}`
			};
		} else {
			console.error('❌ No JSON found in AI response:', text);
		}
	} catch (error) {
		console.error('❌ Classification error:', error);
		if (error instanceof Error) {
			console.error('Error details:', error.message);
		}
	}

	// Return rule-based classification
	console.warn('⚠️ Using rule-based classification');
	return {
		severity: quickSeverity,
		category: quickCategory,
		confidence: 0.7,
		one_line_summary: content.substring(0, 100),
		reasoning: `Rule-based: ${quickCategory}`
	};
}

async function sendInstantAlert(env: Env, feedback: Feedback & { id: string; timestamp: number }): Promise<void> {
	const classification = await env.DB.prepare(
		'SELECT classification_severity, classification_confidence FROM feedback WHERE id = ?'
	).bind(feedback.id).first<{ classification_severity: string; classification_confidence: number }>();

	if (!classification) return;

	const severity = classification.classification_severity || 'P0';
	const confidence = classification.classification_confidence || 1.0;

	// Get category from classification if available
	const category = await classifyFeedback(env, feedback.content);

	const message = formatInstantAlert(feedback, severity, category, confidence);
	const success = await sendTelegramMessage(env, message);

	if (success) {
		const alertId = crypto.randomUUID();
		await env.DB.prepare(
			'INSERT INTO instant_alerts (alert_id, feedback_id, sent_at, severity, category, message) VALUES (?, ?, ?, ?, ?, ?)'
		).bind(alertId, feedback.id, Date.now(), severity, category.category, message).run();

		await env.DB.prepare(
			'UPDATE feedback SET instant_alert_sent = 1 WHERE id = ?'
		).bind(feedback.id).run();
	}
}

function formatInstantAlert(
	feedback: Feedback & { id: string; timestamp: number },
	severity: string,
	category: ClassificationResult,
	confidence: number
): string {
	const timeAgo = getTimeAgo(feedback.timestamp);
	
	// Escape HTML special characters
	const escapeHtml = (text: string): string => {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	};
	
	const summary = escapeHtml(category.one_line_summary);
	const categoryName = escapeHtml(category.category);
	const content = escapeHtml(feedback.content.substring(0, 200));
	const reasoning = escapeHtml(category.reasoning);
	const user = escapeHtml(feedback.user || 'Unknown');
	const source = escapeHtml(feedback.source);
	
	let message = `🚨 <b>INSTANT ALERT - ${severity}</b>

💥 ${summary}
<b>Reports:</b> 1 time ${timeAgo}
<b>Category:</b> ${categoryName}

<b>Issue:</b> ${content}${feedback.content.length > 200 ? '...' : ''}

<b>Reasoning:</b> ${reasoning}

<b>Source:</b> ${source} | <b>User:</b> ${user}`;

	// Add link if provided
	if (feedback.link) {
		const escapedLink = escapeHtml(feedback.link);
		message += `\n🔗 <a href="${escapedLink}">View feedback</a>`;
	}

	message += `\n\n<b>Action Needed:</b> Immediate investigation required`;

	return message;
}

function getTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
	return `${Math.floor(seconds / 86400)} days ago`;
}

// ==================== MORNING DIGEST ====================

async function generateMorningDigest(env: Env): Promise<{ success: boolean; message: string; details?: any }> {
	console.log('Starting morning digest generation...');

	// Get unprocessed feedbacks (not sent as instant alerts)
	const feedbacks = await env.DB.prepare(
		'SELECT * FROM feedback WHERE processed = 0 AND instant_alert_sent = 0 ORDER BY timestamp DESC'
	).all<Feedback & { id: string; timestamp: number; processed: number; instant_alert_sent: number }>();

	if (feedbacks.results.length === 0) {
		const message = 'No unprocessed feedbacks for digest';
		console.log(message);
		return { success: false, message };
	}

	console.log(`Processing ${feedbacks.results.length} feedbacks for digest...`);

	// Cluster feedbacks using embeddings
	const clusters = await clusterFeedbacksWithEmbeddings(env, feedbacks.results);

	// Evaluate fix status for clusters with deployed fixes
	for (const cluster of clusters) {
		if (cluster.fix_status === 'fix_deployed' && cluster.fix_deployed_date) {
			const daysSinceFix = (Date.now() - cluster.fix_deployed_date) / 86400000;
			const rolloutDays = cluster.rollout_period_days || 7;
			
			// If rollout period ended, evaluate success/failure
			if (daysSinceFix > rolloutDays) {
				const avgBeforeFix = (cluster.reports_before_fix || cluster.count) / 7;
				const avgAfterFix = (cluster.reports_after_fix || 0) / rolloutDays;
				
				// Success: reports decreased by 80%+
				if (avgAfterFix < avgBeforeFix * 0.2) {
					cluster.fix_status = 'resolved';
					await env.DB.prepare(
						'UPDATE clusters SET fix_status = ? WHERE cluster_id = ?'
					).bind('resolved', cluster.cluster_id).run();
				} else {
					// Failure: still getting high volume - re-escalate
					cluster.fix_status = 'failed';
					cluster.current_severity = cluster.original_severity || cluster.severity;
					await env.DB.prepare(
						'UPDATE clusters SET fix_status = ?, current_severity = ? WHERE cluster_id = ?'
					).bind('failed', cluster.current_severity, cluster.cluster_id).run();
				}
			} else {
				// Still in rollout - increment reports_after_fix
				const newReportsAfter = (cluster.reports_after_fix || 0) + 1;
				await env.DB.prepare(
					'UPDATE clusters SET reports_after_fix = ? WHERE cluster_id = ?'
				).bind(newReportsAfter, cluster.cluster_id).run();
				cluster.reports_after_fix = newReportsAfter;
			}
		}
	}
	
	// Calculate priority scores for clusters
	for (const cluster of clusters) {
		cluster.priority_score = calculatePriorityScore(cluster);
		await env.DB.prepare(
			'UPDATE clusters SET priority_score = ? WHERE cluster_id = ?'
		).bind(cluster.priority_score, cluster.cluster_id).run();
	}

	// Summarize clusters
	for (const cluster of clusters) {
		const summary = await summarizeCluster(env, cluster);
		cluster.summary = summary.summary;
		cluster.suggested_action = summary.suggested_action;
		cluster.user_impact = summary.user_impact;
		
		await env.DB.prepare(
			'UPDATE clusters SET summary = ?, suggested_action = ?, user_impact = ? WHERE cluster_id = ?'
		).bind(cluster.summary, cluster.suggested_action, cluster.user_impact, cluster.cluster_id).run();
	}

	// Sort by priority score
	clusters.sort((a, b) => b.priority_score - a.priority_score);

	// Separate clusters by status and type
	const generalClusters = clusters.filter(c => c.count > 1);
	
	// Separate individual support from positive feedback
	// Positive feedback indicators
	const isPositiveFeedback = (cluster: Cluster): boolean => {
		const feedback = cluster.representative_feedback.toLowerCase();
		return feedback.includes('great') || 
		       feedback.includes('love') ||
		       feedback.includes('thanks') ||
		       feedback.includes('appreciated') ||
		       feedback.includes('good work') ||
		       feedback.includes('excellent') ||
		       feedback.includes('improved significantly');
	};
	
	const allSingleItemClusters = clusters.filter(c => c.count === 1);
	const individualSupportClusters = allSingleItemClusters.filter(c => !isPositiveFeedback(c));
	const positiveFeedbackClusters = allSingleItemClusters.filter(c => isPositiveFeedback(c));
	
	// Separate by fix status
	const newIssues = generalClusters.filter(c => !c.fix_status || c.fix_status === 'open');
	const fixDeployed = generalClusters.filter(c => c.fix_status === 'fix_deployed');
	const fixFailed = generalClusters.filter(c => c.fix_status === 'failed');
	// Note: fixResolved clusters are not shown in digest (issues are considered closed)

	// Create digest
	const config = getConfig();
	const digestId = crypto.randomUUID();
	
	// Top general issues - prioritize new issues (not fixed)
	const newTopIssues: PriorityIssue[] = newIssues
		.sort((a, b) => b.priority_score - a.priority_score)
		.slice(0, config.digest.maxIssues)
		.map(cluster => ({
			priority_score: cluster.priority_score,
			priority_level: getPriorityLevel(cluster.priority_score),
			cluster
		}));
	
	// Monitoring issues (fixes in progress)
	const monitoringIssues: PriorityIssue[] = fixDeployed
		.sort((a, b) => b.priority_score - a.priority_score)
		.map(cluster => ({
			priority_score: cluster.priority_score,
			priority_level: getPriorityLevel(cluster.priority_score),
			cluster
		}));
	
	// Failed fixes (need re-investigation)
	const failedFixes: PriorityIssue[] = fixFailed
		.sort((a, b) => b.priority_score - a.priority_score)
		.map(cluster => ({
			priority_score: cluster.priority_score,
			priority_level: getPriorityLevel(cluster.priority_score),
			cluster
		}));
	
	// Use new issues as top issues for digest
	const topIssues = newTopIssues;

	// Individual support cases (limit to top 10 by priority)
	const individualSupport: PriorityIssue[] = individualSupportClusters
		.sort((a, b) => b.priority_score - a.priority_score)
		.slice(0, 10)
		.map(cluster => ({
			priority_score: cluster.priority_score,
			priority_level: getPriorityLevel(cluster.priority_score),
			cluster
		}));
	
	// Positive feedback cases
	const positiveSupport: PriorityIssue[] = positiveFeedbackClusters
		.sort((a, b) => b.priority_score - a.priority_score)
		.map(cluster => ({
			priority_score: cluster.priority_score,
			priority_level: getPriorityLevel(cluster.priority_score),
			cluster
		}));

	// Count total feedbacks processed (use actual feedback count, not cluster count sum)
	// Cluster counts include old feedbacks, so we use the actual number of feedbacks we just processed
	const totalFeedbacksProcessed = feedbacks.results.length;
	
	// Count priorities correctly from all clusters, not just topIssues
	const p0Count = clusters.filter(c => getPriorityLevel(c.priority_score) === 'P0').length;
	const p1Count = clusters.filter(c => getPriorityLevel(c.priority_score) === 'P1').length;
	const p2Count = clusters.filter(c => getPriorityLevel(c.priority_score) === 'P2').length;
	const p3Count = clusters.filter(c => getPriorityLevel(c.priority_score) === 'P3').length;
	
	const summary = `${generalClusters.length} general issues and ${individualSupportClusters.length} individual support cases from ${totalFeedbacksProcessed} feedback items. ${p0Count} P0, ${p1Count} P1, ${p2Count} P2, ${p3Count} P3 priorities.`;

	// Include monitoring and failed fixes in digest (for formatting)
	const allIssuesForDigest = [
		...topIssues,
		...monitoringIssues.filter(m => !topIssues.some(t => t.cluster.cluster_id === m.cluster.cluster_id)),
		...failedFixes.filter(f => !topIssues.some(t => t.cluster.cluster_id === f.cluster.cluster_id))
	];
	
	const digest: Digest = {
		digest_id: digestId,
		generated_at: Date.now(),
		top_issues: allIssuesForDigest,
		individual_support: individualSupport,
		positive_feedback: positiveSupport,
		summary
	};

	await env.DB.prepare(
		'INSERT INTO digests (digest_id, generated_at, top_issues, summary) VALUES (?, ?, ?, ?)'
	).bind(
		digestId,
		digest.generated_at,
		JSON.stringify({ 
			top_issues: digest.top_issues, 
			individual_support: digest.individual_support,
			positive_feedback: digest.positive_feedback 
		}),
		summary
	).run();

	// Format and send to Telegram
	const telegramMessage = await formatMorningDigest(env, digest);
	console.log('Sending Telegram message...');
	console.log('Message length:', telegramMessage.length);
	const telegramSuccess = await sendTelegramMessage(env, telegramMessage);

	if (telegramSuccess) {
		await env.DB.prepare(
			'UPDATE digests SET sent_to_telegram = 1 WHERE digest_id = ?'
		).bind(digestId).run();
		console.log('Telegram message sent successfully');
	} else {
		console.error('Failed to send Telegram message');
		console.error('Message preview (first 500 chars):', telegramMessage.substring(0, 500));
		console.error('Message preview (last 500 chars):', telegramMessage.substring(Math.max(0, telegramMessage.length - 500)));
		// Return error details in response
		return {
			success: false,
			message: 'Digest generated but failed to send to Telegram',
			details: {
				feedbacksProcessed: feedbacks.results.length,
				clustersCreated: clusters.length,
				topIssues: digest.top_issues.length,
				digestId,
				messageLength: telegramMessage.length,
				telegramError: lastTelegramError || 'Unknown error - check dev server logs'
			}
		};
	}

	// Mark feedbacks as processed
	await env.DB.prepare(
		'UPDATE feedback SET processed = 1 WHERE processed = 0 AND instant_alert_sent = 0'
	).run();

	console.log('Morning digest generation complete');
	
	return {
		success: telegramSuccess,
		message: telegramSuccess ? 'Digest generated and sent to Telegram' : 'Digest generated but failed to send to Telegram',
		details: {
			feedbacksProcessed: feedbacks.results.length,
			clustersCreated: clusters.length,
			topIssues: digest.top_issues.length,
			digestId
		}
	};
}

// Detect if feedback is user-specific (individual support) vs cumulative bug
function isUserSpecificFeedback(content: string): boolean {
	const lower = content.toLowerCase();
	
	// User-specific indicators
	const userSpecificPatterns = [
		// Personal pronouns indicating individual issue
		/\bmy\s+(subscription|account|billing|payment|data|profile|settings)\b/,
		/\bI\s+(am|was|have|had|see|saw|got|received|paid|charged)\b/,
		/\bmy\s+(user|account)\s+(id|number|email)\b/,
		
		// Account-specific details
		/\b(account|subscription|order)\s+(id|number|#)\s*[:\-]?\s*\w+/i,
		/\b(user|customer)\s+(id|number)\s*[:\-]?\s*\w+/i,
		
		// Individual actions/status
		/\b(my|I)\s+(subscription|account)\s+(expired|cancelled|renewed|charged)/,
		/\bI\s+(can't|cannot|unable)\s+to\s+(access|see|view)\s+my/,
		/\bmy\s+(subscription|account)\s+(got|was)\s+(cancelled|expired|charged)/,
		
		// Personal data references
		/\b(seeing|showing|displaying)\s+(wrong|incorrect|different)\s+(data|information|details)/,
		/\bmy\s+(data|information|details)\s+(is|are|shows|showing)/,
		
		// Individual billing/payment issues
		/\bI\s+(was|got)\s+(charged|billed|refunded)\s+/,
		/\bmy\s+(payment|charge|billing)\s+(failed|succeeded|processed)/,
	];
	
	// Check for user-specific patterns
	for (const pattern of userSpecificPatterns) {
		if (pattern.test(lower)) {
			return true;
		}
	}
	
	// Check for cumulative bug indicators (opposite - these should cluster)
	const cumulativePatterns = [
		/\b(app|application|system)\s+(crashes|crash|crashing)/,
		/\b(when|while)\s+(going|switching|changing|opening|closing)/,
		/\b(theme|dark\s+mode|feature)\s+(not\s+working|broken|doesn't\s+work)/,
		/\b(all|every|many|users|people)\s+(are|can't|cannot)/,
		/\b(affecting|affects)\s+(all|every|many|users)/,
	];
	
	// If it matches cumulative patterns, it's NOT user-specific
	for (const pattern of cumulativePatterns) {
		if (pattern.test(lower)) {
			return false;
		}
	}
	
	// Default: if it has "my" or "I" with account/subscription/billing, it's user-specific
	if (/\b(my|I)\s+.*\b(subscription|account|billing|payment|data)\b/.test(lower)) {
		return true;
	}
	
	return false;
}

async function clusterFeedbacksWithEmbeddings(
	env: Env,
	feedbacks: (Feedback & { id: string; timestamp: number })[]
): Promise<Cluster[]> {
	// Load existing clusters from database
	const config = getConfig();
	const lookbackMs = config.clustering.clusterLookbackDays * 24 * 3600000;
	const existingClustersResult = await env.DB.prepare(
		'SELECT * FROM clusters WHERE last_seen > ? ORDER BY last_seen DESC'
	).bind(Date.now() - lookbackMs).all<any>();

	const clusters: Cluster[] = [];
	
	// Parse existing clusters
	for (const row of existingClustersResult.results || []) {
		try {
			const centroid = JSON.parse(row.centroid || '[]') as number[];
			// Skip clusters with invalid centroids
			
			// Load fix tracking fields
			const cluster: Cluster = {
				cluster_id: row.cluster_id,
				category: row.category,
				severity: row.current_severity || row.severity, // Use current_severity if fix deployed
				centroid,
				count: row.count,
				first_seen: row.first_seen,
				last_seen: row.last_seen,
				representative_feedback_id: row.representative_feedback_id,
				representative_feedback: row.representative_feedback,
				summary: row.summary || '',
				suggested_action: row.suggested_action || '',
				user_impact: row.user_impact || '',
				priority_score: row.priority_score || 0,
				sentiment_score: row.sentiment_score || 0.5,
				top_sources: JSON.parse(row.top_sources || '[]'),
				// Fix tracking
				fix_status: row.fix_status || 'open',
				fix_deployed_date: row.fix_deployed_date,
				fix_deployed_version: row.fix_deployed_version,
				rollout_period_days: row.rollout_period_days || 7,
				original_severity: row.original_severity || row.severity,
				current_severity: row.current_severity || row.severity,
				reports_before_fix: row.reports_before_fix,
				reports_after_fix: row.reports_after_fix,
				fix_notes: row.fix_notes
			};
			if (!Array.isArray(centroid) || centroid.length === 0) {
				continue;
			}
			clusters.push(cluster);
		} catch (e) {
			console.error('Error parsing existing cluster:', e);
		}
	}

	const processed = new Set<string>();
	
	// Load existing cluster members to avoid reprocessing
	const existingMembers = await env.DB.prepare(
		'SELECT feedback_id FROM cluster_members'
	).all<{ feedback_id: string }>();
	
	const alreadyClustered = new Set(
		existingMembers.results?.map(m => m.feedback_id) || []
	);

	for (const feedback of feedbacks) {
		if (processed.has(feedback.id)) continue;
		
		// Skip feedbacks that are already in a cluster
		if (alreadyClustered.has(feedback.id)) {
			processed.add(feedback.id);
			continue;
		}

		// Check if this is user-specific feedback
		const isUserSpecific = isUserSpecificFeedback(feedback.content);
		
		// If user-specific, create individual cluster (don't try to match with others)
		if (isUserSpecific) {
			console.log(`🔍 User-specific feedback detected: ${feedback.content.substring(0, 60)}...`);
			const classification = await classifyFeedback(env, feedback.content);
			const embedding = await generateEmbedding(env, feedback.content);
			const clusterId = crypto.randomUUID();
			const title = `${classification.category} - Individual Support`;
			
			const newCluster: Cluster = {
				cluster_id: clusterId,
				category: classification.category,
				severity: classification.severity,
				centroid: embedding,
				count: 1, // Always 1 for user-specific
				first_seen: feedback.timestamp,
				last_seen: feedback.timestamp,
				representative_feedback_id: feedback.id,
				representative_feedback: feedback.content,
				summary: '',
				suggested_action: '',
				user_impact: '',
				priority_score: 0,
				sentiment_score: 0.5,
				top_sources: [feedback.source]
			};
			
			clusters.push(newCluster);
			
			await env.DB.prepare(
				'INSERT INTO clusters (cluster_id, title, category, severity, centroid, count, first_seen, last_seen, representative_feedback_id, representative_feedback, top_sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			).bind(
				clusterId,
				title,
				classification.category,
				classification.severity,
				JSON.stringify(embedding),
				1,
				feedback.timestamp,
				feedback.timestamp,
				feedback.id,
				feedback.content,
				JSON.stringify([feedback.source])
			).run();
			
			await env.DB.prepare(
				'INSERT INTO cluster_members (cluster_id, feedback_id) VALUES (?, ?)'
			).bind(clusterId, feedback.id).run();
			
			processed.add(feedback.id);
			continue; // Skip to next feedback - don't try to cluster user-specific issues
		}

		// Generate embedding for cumulative bugs
		const embedding = await generateEmbedding(env, feedback.content);
		
		// Find similar cluster - try embedding similarity first, then fallback to text-based
		let matchedCluster: Cluster | null = null;
		const config = getConfig();
		
		// Check if embedding is valid (not all zeros)
		const hasValidEmbedding = embedding.some(val => val !== 0);
		
		if (hasValidEmbedding) {
			// Use embedding-based similarity (only match with non-user-specific clusters)
			for (const cluster of clusters) {
				// Skip user-specific clusters (count === 1 with user-specific pattern)
				if (cluster.count === 1 && isUserSpecificFeedback(cluster.representative_feedback)) {
					continue;
				}
				
				if (cluster.centroid.some(val => val !== 0)) { // Only compare with valid centroids
					const similarity = cosineSimilarity(embedding, cluster.centroid);
					console.log(`Similarity with cluster ${cluster.cluster_id.substring(0, 8)}...: ${similarity.toFixed(3)}`);
					if (similarity > config.clustering.similarityThreshold) {
						console.log(`✅ Matched cluster ${cluster.cluster_id.substring(0, 8)}... (similarity: ${similarity.toFixed(3)})`);
						matchedCluster = cluster;
						break;
					}
				}
			}
		}
		
		// Fallback: text-based similarity if embeddings failed or no match found
		// Only match cumulative bugs, not user-specific issues
		if (!matchedCluster) {
			const classification = await classifyFeedback(env, feedback.content);
			const feedbackLower = feedback.content.toLowerCase();
			
			// Extract key phrases using patterns
			const extractKeyPhrases = (text: string): Set<string> => {
				const phrases = new Set<string>();
				const lower = text.toLowerCase();
				
				// Common issue patterns
				const patterns = [
					/login\s+\w+/g,
					/billing\s+\w+/g,
					/payment\s+\w+/g,
					/crash\w*/g,
					/error\s+\d+/g,
					/\b(can't|cannot|won't)\s+\w+/g,
					/dark\s+mode/g,
					/rate\s+limit/g,
					/\d+\s+error/g,
					/login\s+crash/g,
					/login\s+bug/g,
					/billing\s+page/g,
					/payment\s+failed/g,
					// Theme/toggle related
					/theme\s+\w+/g,
					/toggle\s+\w+/g,
					/dark\s+mode\s+\w*/g,
					// Resume/background crash
					/resume\s+crash/g,
					/background\s+\w+/g,
					/foreground\s+\w+/g,
					/force\s+close/g,
					// Double login
					/double\s+login/g,
					/login\s+twice/g,
					/second\s+login/g,
					/first\s+login/g,
					/2\s+attempts/g
				];
				
				patterns.forEach(pattern => {
					const matches = lower.match(pattern);
					if (matches) matches.forEach(m => phrases.add(m.trim()));
				});
				
				// Add normalized theme-related phrase if any theme keywords present
				if (lower.includes('theme') || lower.includes('dark mode') || lower.includes('toggle')) {
					if (lower.includes('broken') || lower.includes('not working') || lower.includes("doesn't") || 
						lower.includes('fails') || lower.includes('no change')) {
						phrases.add('theme_bug'); // Normalized key for all theme bugs
					}
				}
				
				// Add normalized resume crash phrase
				if ((lower.includes('resume') || lower.includes('background') || lower.includes('foreground') || 
					 lower.includes('recents')) && lower.includes('crash')) {
					phrases.add('resume_crash'); // Normalized key for all resume crashes
				}
				
				return phrases;
			};
			
			for (const cluster of clusters) {
				// Skip user-specific clusters when matching cumulative bugs
				if (cluster.count === 1 && isUserSpecificFeedback(cluster.representative_feedback)) {
					continue;
				}
				
				const clusterLower = cluster.representative_feedback.toLowerCase();
				
				// First, try phrase matching
				const feedbackPhrases = extractKeyPhrases(feedbackLower);
				const clusterPhrases = extractKeyPhrases(clusterLower);
				const commonPhrases = [...feedbackPhrases].filter(p => clusterPhrases.has(p));
				
				if (commonPhrases.length > 0) {
					console.log(`✅ Text match found: ${commonPhrases.join(', ')}`);
					matchedCluster = cluster;
					break;
				}
				
				// Then try category + severity + keyword overlap
				if (cluster.category === classification.category && 
					cluster.severity === classification.severity) {
					
					// Extract key words (length > 2, not common stop words)
					const stopWords = new Set(['the', 'this', 'that', 'with', 'from', 'when', 'will', 'need', 'very', 'can', 'cant', 'not', 'and', 'are', 'for', 'has', 'have', 'was', 'were', 'all', 'but', 'get', 'got']);
					const feedbackWords = new Set(
						feedbackLower.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w))
					);
					const clusterWords = new Set(
						clusterLower.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w))
					);
					
					const commonWords = [...feedbackWords].filter(w => clusterWords.has(w));
					
					// If at least 1 common significant word, consider it a match
					if (commonWords.length >= 1) {
						console.log(`✅ Keyword match found: ${commonWords.join(', ')}`);
						matchedCluster = cluster;
						break;
					}
				}
			}
		}

		if (matchedCluster) {
			// Add to existing cluster
			matchedCluster.count++;
			matchedCluster.last_seen = Math.max(matchedCluster.last_seen, feedback.timestamp);
			if (!matchedCluster.top_sources.includes(feedback.source)) {
				matchedCluster.top_sources.push(feedback.source);
			}
			
			// Update centroid (running average) - ensure same length
			if (embedding.length === matchedCluster.centroid.length) {
				matchedCluster.centroid = matchedCluster.centroid.map((val, i) => 
					(val * (matchedCluster!.count - 1) + embedding[i]) / matchedCluster!.count
				);
			} else {
				console.warn(`Embedding length mismatch for cluster ${matchedCluster.cluster_id}`);
			}

			// Check if feedback is already in this cluster
			const existingMember = await env.DB.prepare(
				'SELECT 1 FROM cluster_members WHERE cluster_id = ? AND feedback_id = ?'
			).bind(matchedCluster.cluster_id, feedback.id).first();
			
			if (!existingMember) {
				await env.DB.prepare(
					'INSERT INTO cluster_members (cluster_id, feedback_id) VALUES (?, ?)'
				).bind(matchedCluster.cluster_id, feedback.id).run();
			}

			await env.DB.prepare(
				'UPDATE clusters SET count = ?, last_seen = ?, top_sources = ?, centroid = ? WHERE cluster_id = ?'
			).bind(
				matchedCluster.count,
				matchedCluster.last_seen,
				JSON.stringify(matchedCluster.top_sources),
				JSON.stringify(matchedCluster.centroid),
				matchedCluster.cluster_id
			).run();
		} else {
			// Create new cluster
			const classification = await classifyFeedback(env, feedback.content);
			const clusterId = crypto.randomUUID();
			
			// Generate a title from category or feedback content
			const title = classification.category.charAt(0).toUpperCase() + classification.category.slice(1) + ' Issue';
			
			const newCluster: Cluster = {
				cluster_id: clusterId,
				category: classification.category,
				severity: classification.severity,
				centroid: embedding,
				count: 1,
				first_seen: feedback.timestamp,
				last_seen: feedback.timestamp,
				representative_feedback_id: feedback.id,
				representative_feedback: feedback.content,
				summary: '',
				suggested_action: '',
				user_impact: '',
				priority_score: 0,
				sentiment_score: 0.5,
				top_sources: [feedback.source]
			};

			clusters.push(newCluster);

			await env.DB.prepare(
				'INSERT INTO clusters (cluster_id, title, category, severity, centroid, count, first_seen, last_seen, representative_feedback_id, representative_feedback, top_sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			).bind(
				clusterId,
				title,
				classification.category,
				classification.severity,
				JSON.stringify(embedding),
				1,
				feedback.timestamp,
				feedback.timestamp,
				feedback.id,
				feedback.content,
				JSON.stringify([feedback.source])
			).run();

			// Check if feedback is already in this cluster (shouldn't happen for new clusters, but be safe)
			const existingMember = await env.DB.prepare(
				'SELECT 1 FROM cluster_members WHERE cluster_id = ? AND feedback_id = ?'
			).bind(clusterId, feedback.id).first();
			
			if (!existingMember) {
				await env.DB.prepare(
					'INSERT INTO cluster_members (cluster_id, feedback_id) VALUES (?, ?)'
				).bind(clusterId, feedback.id).run();
			}
		}

		processed.add(feedback.id);
	}

	return clusters;
}

async function generateEmbedding(env: Env, text: string): Promise<number[]> {
	if (!text || text.trim().length === 0) {
		console.warn('Empty text provided for embedding');
		return new Array(1024).fill(0);
	}

	try {
		const config = getConfig();
		const model = config.ai.embeddingModel as keyof AiModels;
		const response = await env.AI.run(model, {
			text: text
		}) as { data?: number[][]; shape?: number[] };

		// bge-m3 returns embeddings in response.data (2D array)
		if (response && response.data && Array.isArray(response.data) && response.data.length > 0) {
			const embedding = response.data[0] as number[];
			if (Array.isArray(embedding) && embedding.length > 0) {
				return embedding;
			}
		}
	} catch (error) {
		console.error('Embedding generation error:', error);
	}

	// Fallback: return zero vector (will create new clusters)
	// Note: This will prevent matching with existing clusters, creating new ones
	const config = getConfig();
	return new Array(config.clustering.embeddingDimension).fill(0);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
	if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
	if (vecA.length !== vecB.length) return 0;
	
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < vecA.length; i++) {
		dotProduct += vecA[i] * vecB[i];
		normA += vecA[i] * vecA[i];
		normB += vecB[i] * vecB[i];
	}

	if (normA === 0 || normB === 0) return 0;
	const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	return isNaN(similarity) ? 0 : similarity;
}

function calculatePriorityScore(cluster: Cluster): number {
	const config = getConfig();
	
	// Check if fix is deployed - use current_severity (downgraded) instead of original
	let effectiveSeverity = cluster.severity;
	if (cluster.fix_status === 'fix_deployed' && cluster.current_severity) {
		effectiveSeverity = cluster.current_severity;
	} else if (cluster.fix_status === 'failed') {
		// Fix failed - use original severity (re-escalate)
		effectiveSeverity = cluster.original_severity || cluster.severity;
	}
	
	// Severity score (0-100)
	const severityMap: Record<string, number> = { P0: 100, P1: 75, P2: 50, P3: 25 };
	const severityScore = severityMap[effectiveSeverity] || 50;

	// Frequency score (0-100) - logarithmic scale
	const frequencyScore = Math.min(100, Math.log10(cluster.count + 1) * 50);

	// Recency score (0-100)
	const hoursSinceLastSeen = (Date.now() - cluster.last_seen) / 3600000;
	const recencyScore = Math.max(0, 100 - (hoursSinceLastSeen * 2));

	// Sentiment score (0-100) - negativity boosts priority
	const negativityScore = 100 - (cluster.sentiment_score * 100);

	// Weighted formula using config
	return (
		severityScore * config.priority.severityWeight +
		frequencyScore * config.priority.frequencyWeight +
		recencyScore * config.priority.recencyWeight +
		negativityScore * config.priority.sentimentWeight
	);
}

function getPriorityLevel(score: number): string {
	const config = getConfig();
	if (score >= config.priorityThresholds.p0) return 'P0';
	if (score >= config.priorityThresholds.p1) return 'P1';
	if (score >= config.priorityThresholds.p2) return 'P2';
	return 'P3';
}

async function summarizeCluster(env: Env, cluster: Cluster): Promise<{
	summary: string;
	suggested_action: string;
	user_impact: string;
}> {
	// Get actual feedback examples from the cluster
	const members = await env.DB.prepare(
		'SELECT f.content FROM cluster_members cm JOIN feedback f ON cm.feedback_id = f.id WHERE cm.cluster_id = ? LIMIT 3'
	).bind(cluster.cluster_id).all<{ content: string }>();
	
	const examples = members.results?.map(m => m.content.substring(0, 150)).join('\n') || cluster.representative_feedback.substring(0, 150);
	
	// Action suggestions - specific and actionable
	const actionMap: Record<string, string> = {
		'crash': 'Investigate lifecycle/memory - check onResume handlers',
		'login': 'Check auth flow - token storage and session management',
		'payment': 'URGENT: Check payment gateway integration',
		'billing': 'Check billing API and payment processing',
		'performance': 'Profile and optimize - check network/rendering',
		'ui': 'Review UI state management and theme persistence',
		'feature_request': 'Add to backlog for prioritization',
		'bug': 'Debug and fix - check logs for root cause',
		'other': 'Investigate - gather more details from users'
	};
	
	const impactMap: Record<string, string> = {
		'P0': 'Critical - Service completely unusable',
		'P1': 'Major - Core feature broken, affecting many users',
		'P2': 'Moderate - Minor issue with workaround available',
		'P3': 'Low - Enhancement or nice-to-have'
	};
	
	// Create a clear, actionable summary - no complex extraction, just clear patterns
	const generateSmartSummary = (): string => {
		const content = cluster.representative_feedback.toLowerCase();
		const version = cluster.representative_feedback.match(/v\d+\.\d+\.\d+/i)?.[0];
		
		// Background/foreground/resume crash - MOST COMMON P0
		if (content.includes('background') || content.includes('foreground') || content.includes('resume') || 
			content.includes('recents') || content.includes('multitask')) {
			let summary = `Resume crash: switch apps or lock/unlock → return to app → force close (${cluster.count})`;
			if (version) summary += ` [${version}]`;
			return summary;
		}
		
		// Login crash
		if (content.includes('login') && content.includes('crash')) {
			let summary = `Login crash: tap Sign In → app force closes (${cluster.count})`;
			if (version) summary += ` [${version}]`;
			return summary;
		}
		
		// Generic crash
		if (content.includes('crash') || content.includes('force close')) {
			let summary = `App crash: unexpected force close (${cluster.count})`;
			if (version) summary += ` [${version}]`;
			return summary;
		}
		
		// Double login bug
		if (content.includes('twice') || content.includes('2 attempts') || content.includes('double') || 
			content.includes('second login') || content.includes('first login') || content.includes('first attempt')) {
			return `Double login bug: 1st login → dashboard flashes → back to login → 2nd login works (${cluster.count})`;
		}
		
		// Theme toggle broken (bug, not feature request)
		if ((content.includes('theme') || content.includes('dark mode')) && 
			(content.includes('broken') || content.includes('not working') || content.includes("doesn't apply") || 
			 content.includes('no change') || content.includes('fails') || content.includes('never changes'))) {
			return `Theme toggle bug: enable Dark Mode → toggle animates but UI stays light (${cluster.count})`;
		}
		
		// Dark mode feature request
		if (content.includes('dark mode') && (content.includes('feature') || content.includes('request') || 
			content.includes('would love') || content.includes('add') || content.includes('want'))) {
			return `Feature request: add dark mode to dashboard (${cluster.count})`;
		}
		
		// Documentation outdated
		if (content.includes('docs') || content.includes('documentation')) {
			return `Docs outdated: API examples return errors, need update (${cluster.count})`;
		}
		
		// UI/Navigation
		if (content.includes('ui') || content.includes('navigation') || content.includes('confusing')) {
			return `Navigation unclear: hard to find settings (${cluster.count})`;
		}
		
		// Generic bug with attempted detail extraction
		const original = cluster.representative_feedback;
		if (cluster.category === 'bug' || content.includes('bug') || content.includes('broken') || content.includes('not working')) {
			const whatBroken = original.match(/(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:is\s+)?(?:not working|broken|doesn't work|won't work)/i);
			if (whatBroken) {
				return `${whatBroken[1]} broken (${cluster.count})`;
			}
		}
		
		// Fallback - first sentence if reasonable length
		const firstSentence = original.split(/[.!?]/)[0].trim();
		if (firstSentence.length > 20 && firstSentence.length < 80) {
			return `${firstSentence} (${cluster.count})`;
		}
		
		return `${cluster.category} issue - see reports (${cluster.count})`;
	};
	
	const defaultSummary = {
		summary: generateSmartSummary(),
		suggested_action: actionMap[cluster.category] || 'Investigation Required',
		user_impact: impactMap[cluster.severity] || 'User experience affected'
	};
	
	console.log(`📝 Summarizing cluster ${cluster.cluster_id.substring(0, 8)}... (${cluster.count} reports)`);
	
	// Try AI summarization - focus on actionable details
	const isCrashIssue = cluster.category === 'crash' || cluster.category === 'login' || 
		cluster.representative_feedback.toLowerCase().includes('crash');
	
	const simplePrompt = isCrashIssue 
		? `Summarize these ${cluster.count} crash reports. Focus on: WHAT triggers the crash and WHAT happens (the symptom).

${examples}

Return JSON: {"summary":"[trigger] → [symptom] (e.g. 'tap Sign In → app force closes')","action":"Bug Fix","impact":"users cannot [action]"}`
		: `Summarize these ${cluster.count} similar user complaints in one sentence:

${examples}

Return JSON: {"summary":"one sentence","action":"Bug Fix|UX Improvement|New Feature","impact":"how users are affected"}`;

	try {
		const config = getConfig();
		const model = config.ai.classificationModel as keyof AiModels;
		const response = await env.AI.run(model, {
			messages: [
				{ role: 'user', content: simplePrompt }
			],
			max_tokens: 200,
			temperature: 0.3
		});

		let text = "";
		if (typeof response === "string") {
			text = response;
		} else if (response && typeof (response as any).response === "string") {
			text = (response as any).response;
		}

		console.log(`🤖 AI summary response: ${text.substring(0, 200)}`);

		const jsonMatch = text.match(/\{[\s\S]*?\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			console.log(`✅ AI summary: ${parsed.summary}`);
			return {
				summary: parsed.summary || defaultSummary.summary,
				suggested_action: parsed.action || defaultSummary.suggested_action,
				user_impact: parsed.impact || defaultSummary.user_impact
			};
		} else {
			console.warn(`❌ No JSON found in AI summary response`);
		}
	} catch (error) {
		console.error('❌ AI summarization failed:', error);
		if (error instanceof Error) {
			console.error('Error details:', error.message);
		}
	}

	console.log(`📝 Using smart fallback summary: ${defaultSummary.summary}`);
	return defaultSummary;
}

async function formatMorningDigest(env: Env, digest: Digest): Promise<string> {
	const config = getConfig();
	// Format date in PT timezone with proper time
	const date = new Date(digest.generated_at).toLocaleString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: config.digest.timezone,
		timeZoneName: 'short'
	});

	// Helper to escape HTML special characters
	const escapeHtml = (text: string): string => {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	};
	
	let message = `<b>MORNING DIGEST - ${escapeHtml(date)}</b>\n\n`;
	// Safely extract feedback count from summary
	const feedbackCountMatch = digest.summary.match(/(\d+)\s+feedback/);
	const feedbackCount = feedbackCountMatch ? feedbackCountMatch[1] : 'multiple';
	
	const priorityEmojis: Record<string, string> = { P0: '🔴', P1: '🟠', P2: '🟡', P3: '🟢' };
	
	// Get all general issues (multi-user clusters) - sorted by priority
	const generalIssues = digest.top_issues
		.filter(i => !i.cluster.fix_status || i.cluster.fix_status === 'open')
		.sort((a, b) => {
			// First sort by priority level (P0 > P1 > P2 > P3)
			const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
			const levelDiff = priorityOrder[a.priority_level] - priorityOrder[b.priority_level];
			if (levelDiff !== 0) return levelDiff;
			// Then by priority score (higher first)
			return b.priority_score - a.priority_score;
		});
	
	// Display all general issues in priority order (no priority numbers, just priority level)
	if (generalIssues.length > 0) {
		message += `<b>📋 Issues</b> (from ${feedbackCount} feedbacks)\n\n`;

		generalIssues.forEach((issue, index) => {
			const emoji = priorityEmojis[issue.priority_level] || '⚪';
			const summary = escapeHtml(issue.cluster.summary || issue.cluster.representative_feedback.substring(0, 50));
			const impact = escapeHtml(issue.cluster.user_impact || 'User experience affected');
			const action = escapeHtml(issue.cluster.suggested_action);
			
			// Show priority level, not priority number
			message += `${index + 1}. ${emoji} <b>${issue.priority_level}</b> - ${summary} (${issue.cluster.count} reports)\n`;
			message += `   ${impact}\n`;
			message += `   → ${action}\n`;
			
			// Add source breakdown if available
			if (issue.cluster.top_sources && issue.cluster.top_sources.length > 0) {
				const sources = issue.cluster.top_sources.slice(0, 3).join(', ');
				message += `   Sources: ${sources}${issue.cluster.top_sources.length > 3 ? '...' : ''}\n`;
			}
			
			message += `\n`;
		});
	}
	
	// Monitoring - Fixes in progress
	const monitoringIssues = digest.top_issues.filter(i => i.cluster.fix_status === 'fix_deployed');
	if (monitoringIssues.length > 0) {
		message += `\n<b>🔧 Monitoring - Fixes in Progress</b>\n\n`;
		monitoringIssues.forEach(issue => {
			const daysSinceFix = issue.cluster.fix_deployed_date 
				? Math.floor((Date.now() - issue.cluster.fix_deployed_date) / 86400000)
				: 0;
			const rolloutDays = issue.cluster.rollout_period_days || 7;
			const summary = escapeHtml(issue.cluster.summary || issue.cluster.representative_feedback.substring(0, 50));
			const emoji = priorityEmojis[issue.priority_level] || '⚪';
			
			// Calculate trend
			const avgBefore = (issue.cluster.reports_before_fix || issue.cluster.count) / 7;
			const avgAfter = (issue.cluster.reports_after_fix || 0) / Math.max(1, daysSinceFix);
			const trend = avgAfter < avgBefore * 0.5 ? '↓' : avgAfter > avgBefore * 1.5 ? '↑' : '→';
			
			message += `${emoji} <b>${issue.priority_level}</b> - ${summary} (${issue.cluster.count} reports) 🔧\n`;
			message += `   Status: Fix Deployed (Day ${daysSinceFix}/${rolloutDays}) - Awaiting rollout\n`;
			message += `   Reports trending ${trend} ${avgBefore.toFixed(1)}/day → ${avgAfter.toFixed(1)}/day\n`;
			if (issue.cluster.fix_deployed_version) {
				message += `   Version: ${escapeHtml(issue.cluster.fix_deployed_version)}\n`;
			}
			message += `   → No action needed - monitoring\n\n`;
		});
	}
	
	// Failed Fixes - Need re-investigation
	const failedFixes = digest.top_issues.filter(i => i.cluster.fix_status === 'failed');
	if (failedFixes.length > 0) {
		message += `\n<b>🚨 Failed Fixes - Need Attention</b>\n\n`;
		failedFixes.forEach(issue => {
			const daysSinceFix = issue.cluster.fix_deployed_date 
				? Math.floor((Date.now() - issue.cluster.fix_deployed_date) / 86400000)
				: 0;
			const summary = escapeHtml(issue.cluster.summary || issue.cluster.representative_feedback.substring(0, 50));
			const emoji = priorityEmojis[issue.priority_level] || '⚪';
			
			message += `${emoji} <b>${issue.priority_level}</b> - ${summary} (${issue.cluster.count} reports) ⚠️\n`;
			message += `   Status: FIX FAILED - Still getting high volume\n`;
			message += `   Original fix: ${daysSinceFix} days ago\n`;
			message += `   → URGENT: Fix didn't work, needs re-investigation\n\n`;
		});
	}

	// Individual Support Cases - Show ALL cases with full details
	// Note: Positive feedback is already separated into digest.positive_feedback
	if (digest.individual_support && digest.individual_support.length > 0) {
		message += `\n<b>Individual Support Cases</b> (${digest.individual_support.length} cases)\n\n`;
		message += `<i>Single-user issues requiring individual attention:</i>\n\n`;
		
		// Show ALL cases
		for (const issue of digest.individual_support) {
			// Get the actual feedback text and link for individual cases
			const feedbackResult = await env.DB.prepare(
				'SELECT f.content, f.source, f.user, f.link FROM cluster_members cm JOIN feedback f ON cm.feedback_id = f.id WHERE cm.cluster_id = ? LIMIT 1'
			).bind(issue.cluster.cluster_id).first<{ content: string; source: string; user: string; link: string }>();
			
			const feedbackText = feedbackResult?.content || issue.cluster.representative_feedback;
			const user = feedbackResult?.user || 'Unknown';
			const source = feedbackResult?.source || 'unknown';
			const link = feedbackResult?.link;
			
			const escapedCategory = escapeHtml(issue.cluster.category);
			const escapedUser = escapeHtml(user || 'Unknown');
			const escapedSource = escapeHtml(source);
			const escapedFeedback = escapeHtml(feedbackText.substring(0, 120));
			const escapedLink = link ? escapeHtml(link) : null;
			
			message += `• <b>${escapedCategory}</b> (${issue.priority_level}) - User: ${escapedUser} via ${escapedSource}\n`;
			message += `  "${escapedFeedback}${feedbackText.length > 120 ? '...' : ''}"\n`;
			if (escapedLink) {
				message += `  🔗 <a href="${escapedLink}">View feedback</a>\n`;
			}
			message += `\n`;
		}
	}
	
	// Positive feedback from digest.positive_feedback (already separated)
	const positiveFeedback = digest.positive_feedback || [];
	
	// Show positive feedback in separate section - Show ALL cases (NO LINKS)
	if (positiveFeedback.length > 0) {
		message += `\n━━━━━━━━━━━━━━━━\n\n`;
		message += `<b>✅ What's Working Well</b> (${positiveFeedback.length} positive feedbacks)\n\n`;
		message += `<i>User appreciation and positive feedback:</i>\n\n`;
		
		// Show ALL positive feedbacks
		// Note: Links are NOT shown for positive feedback
		for (const issue of positiveFeedback) {
			const feedbackResult = await env.DB.prepare(
				'SELECT f.content, f.source, f.user FROM cluster_members cm JOIN feedback f ON cm.feedback_id = f.id WHERE cm.cluster_id = ? LIMIT 1'
			).bind(issue.cluster.cluster_id).first<{ content: string; source: string; user: string }>();
			
			const feedbackText = feedbackResult?.content || issue.cluster.representative_feedback;
			const user = feedbackResult?.user || 'Unknown';
			const source = feedbackResult?.source || 'unknown';
			
			const escapedUser = escapeHtml(user || 'Unknown');
			const escapedSource = escapeHtml(source);
			const escapedFeedback = escapeHtml(feedbackText.substring(0, 100));
			
			message += `• User: ${escapedUser} via ${escapedSource}\n`;
			message += `  "${escapedFeedback}${feedbackText.length > 100 ? '...' : ''}"\n\n`;
		}
	}

	message += `\n<b>Summary:</b> ${escapeHtml(digest.summary)}`;

	return message;
}

let lastTelegramError: string | null = null;

async function sendTelegramMessage(env: Env, message: string): Promise<boolean> {
	lastTelegramError = null; // Clear previous error
	const config = getConfig(env);
	const botToken = config.telegram.botToken;
	const chatId = config.telegram.chatId;

	if (!botToken || !chatId) {
		const error = 'Telegram credentials not configured';
		console.error(error);
		console.error('Bot Token:', botToken ? `${botToken.substring(0, 10)}...` : 'Missing');
		console.error('Chat ID:', chatId ? chatId : 'Missing');
		lastTelegramError = error;
		return false;
	}

	try {
		// Telegram has a 4096 character limit per message
		const MAX_MESSAGE_LENGTH = 4096;
		let messageToSend = message;
		
		if (message.length > MAX_MESSAGE_LENGTH) {
			console.warn(`Message too long (${message.length} chars), truncating to ${MAX_MESSAGE_LENGTH}`);
			// Truncate more aggressively and add summary at end
			const truncatePoint = MAX_MESSAGE_LENGTH - 200;
			messageToSend = message.substring(0, truncatePoint) + '\n\n... (message truncated due to length limit)\n\n' + message.substring(message.lastIndexOf('*Summary:*'));
		}

		const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
		
		// Escape markdown special characters to prevent parsing errors
		const escapeMarkdown = (text: string): string => {
			// Escape special markdown characters that aren't part of our intentional formatting
			// Keep intentional markdown (* for bold, _ for italic) but escape others
			return text
				.replace(/\*/g, '\\*')  // Escape asterisks
				.replace(/_/g, '\\_')   // Escape underscores
				.replace(/\[/g, '\\[')   // Escape brackets
				.replace(/\]/g, '\\]')
				.replace(/\(/g, '\\(')   // Escape parentheses in links
				.replace(/\)/g, '\\)')
				.replace(/`/g, '\\`')   // Escape backticks
				.replace(/#/g, '\\#');  // Escape hashes
		};
		
		// Message is already formatted in HTML (from formatMorningDigest/formatInstantAlert)
		// Just send it as-is with HTML parse mode
		const payload = {
			chat_id: chatId,
			text: messageToSend,
			parse_mode: 'HTML'  // Use HTML - more reliable than Markdown
		};

		console.log('Sending to Telegram:', url);
		console.log('Message length:', messageToSend.length);
		
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const result = await response.json() as { ok?: boolean; description?: string; error_code?: number; parameters?: any };
		
		if (!result.ok) {
			const errorMsg = `Telegram API error: ${result.description || 'Unknown error'} (code: ${result.error_code || 'N/A'})`;
			console.error('Telegram API error:', JSON.stringify(result, null, 2));
			console.error('Error code:', result.error_code);
			console.error('Error description:', result.description);
			console.error('Error parameters:', result.parameters);
			
			// Common issues:
			if (result.description?.includes('parse')) {
				console.error('⚠️ Markdown parsing error - check for special characters in message');
			}
			if (result.description?.includes('too long')) {
				console.error('⚠️ Message too long - needs truncation');
			}
			lastTelegramError = errorMsg;
			return false;
		}
		
		console.log('Telegram message sent successfully');
		return true;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('Telegram send error:', error);
		if (error instanceof Error) {
			console.error('Error message:', error.message);
			console.error('Error stack:', error.stack);
		}
		lastTelegramError = `Network/Request error: ${errorMsg}`;
		return false;
	}
}

