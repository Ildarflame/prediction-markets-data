/**
 * Market Link Review Server (v3.1.0)
 *
 * Simple web UI for reviewing and confirming/rejecting market links.
 * Keyboard shortcuts: Y = confirm, N = reject, Space = next
 */

import express from 'express';
import { getClient } from '@data-module/db';

const PORT = parseInt(process.env.REVIEW_PORT || '3000', 10);
const MIN_SCORE = parseFloat(process.env.REVIEW_MIN_SCORE || '0.75');
const LIMIT = parseInt(process.env.REVIEW_LIMIT || '500', 10);

const app = express();
app.use(express.json());

const prisma = getClient();

// Serve static HTML
app.get('/', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market Link Review</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: #2d2d2d;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stats { display: flex; gap: 20px; font-size: 14px; }
    .stat { background: #3a3a3a; padding: 8px 16px; border-radius: 4px; }
    .stat-label { color: #888; font-size: 12px; }
    .stat-value { color: #4caf50; font-size: 18px; font-weight: bold; }
    .review-card {
      background: #2d2d2d;
      border-radius: 8px;
      padding: 30px;
      margin-bottom: 20px;
    }
    .markets {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin: 20px 0;
    }
    .market {
      background: #3a3a3a;
      padding: 20px;
      border-radius: 8px;
    }
    .market-venue {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .market-title {
      font-size: 18px;
      line-height: 1.6;
      margin-bottom: 12px;
    }
    .market-meta {
      display: flex;
      gap: 12px;
      font-size: 13px;
      color: #888;
    }
    .meta-item { display: flex; align-items: center; gap: 4px; }
    .link-meta {
      display: flex;
      gap: 20px;
      margin: 20px 0;
      padding: 15px;
      background: #252525;
      border-radius: 6px;
      font-size: 13px;
    }
    .link-meta-item { display: flex; gap: 8px; }
    .link-meta-label { color: #888; }
    .link-meta-value { color: #e0e0e0; font-weight: 500; }
    .score { color: #4caf50; font-weight: bold; font-size: 16px; }
    .actions {
      display: flex;
      gap: 15px;
      justify-content: center;
      margin-top: 30px;
    }
    button {
      padding: 12px 30px;
      font-size: 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 500;
    }
    button:hover { transform: translateY(-2px); }
    .btn-confirm {
      background: #4caf50;
      color: white;
    }
    .btn-confirm:hover { background: #45a049; }
    .btn-reject {
      background: #f44336;
      color: white;
    }
    .btn-reject:hover { background: #da190b; }
    .btn-skip {
      background: #757575;
      color: white;
    }
    .btn-skip:hover { background: #616161; }
    .shortcuts {
      text-align: center;
      margin-top: 20px;
      color: #888;
      font-size: 13px;
    }
    .loading {
      text-align: center;
      padding: 50px;
      font-size: 18px;
      color: #888;
    }
    .empty {
      text-align: center;
      padding: 50px;
      font-size: 18px;
      color: #888;
      background: #2d2d2d;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔗 Market Link Review</h1>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Reviewed</div>
          <div class="stat-value" id="stat-reviewed">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Confirmed</div>
          <div class="stat-value" id="stat-confirmed" style="color: #4caf50;">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Rejected</div>
          <div class="stat-value" id="stat-rejected" style="color: #f44336;">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Remaining</div>
          <div class="stat-value" id="stat-remaining">...</div>
        </div>
      </div>
    </div>

    <div id="review-content">
      <div class="loading">Loading...</div>
    </div>
  </div>

  <script>
    let currentLink = null;
    let reviewedCount = 0;
    let confirmedCount = 0;
    let rejectedCount = 0;

    async function loadStats() {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      document.getElementById('stat-remaining').textContent = stats.remaining;
    }

    async function loadNext() {
      try {
        const res = await fetch('/api/links');
        const link = await res.json();

        if (!link.id) {
          document.getElementById('review-content').innerHTML = \`
            <div class="empty">
              <h2>🎉 All done!</h2>
              <p style="margin-top: 10px;">No more links to review.</p>
            </div>
          \`;
          return;
        }

        currentLink = link;
        renderLink(link);
        await loadStats();
      } catch (error) {
        console.error('Failed to load link:', error);
      }
    }

    function renderLink(link) {
      const html = \`
        <div class="review-card">
          <div class="link-meta">
            <div class="link-meta-item">
              <span class="link-meta-label">ID:</span>
              <span class="link-meta-value">\${link.id}</span>
            </div>
            <div class="link-meta-item">
              <span class="link-meta-label">Topic:</span>
              <span class="link-meta-value">\${link.topic}</span>
            </div>
            <div class="link-meta-item">
              <span class="link-meta-label">Score:</span>
              <span class="score">\${link.score.toFixed(3)}</span>
            </div>
            <div class="link-meta-item">
              <span class="link-meta-label">Algorithm:</span>
              <span class="link-meta-value">\${link.algoVersion}</span>
            </div>
          </div>

          <div class="markets">
            <div class="market">
              <div class="market-venue">📊 Polymarket</div>
              <div class="market-title">\${link.leftMarket.title}</div>
              <div class="market-meta">
                <div class="meta-item">
                  <span>Status:</span>
                  <span>\${link.leftMarket.status}</span>
                </div>
                <div class="meta-item">
                  <span>Outcomes:</span>
                  <span>\${link.leftMarket.outcomesCount}</span>
                </div>
              </div>
            </div>

            <div class="market">
              <div class="market-venue">🎯 Kalshi</div>
              <div class="market-title">\${link.rightMarket.title}</div>
              <div class="market-meta">
                <div class="meta-item">
                  <span>Status:</span>
                  <span>\${link.rightMarket.status}</span>
                </div>
                <div class="meta-item">
                  <span>Outcomes:</span>
                  <span>\${link.rightMarket.outcomesCount}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="actions">
            <button class="btn-confirm" onclick="confirm()">
              ✓ Confirm (Y)
            </button>
            <button class="btn-skip" onclick="loadNext()">
              → Skip (Space)
            </button>
            <button class="btn-reject" onclick="reject()">
              ✗ Reject (N)
            </button>
          </div>

          <div class="shortcuts">
            Keyboard: Y = Confirm | N = Reject | Space = Skip
          </div>
        </div>
      \`;

      document.getElementById('review-content').innerHTML = html;
    }

    async function confirm() {
      if (!currentLink) return;

      try {
        await fetch(\`/api/links/\${currentLink.id}/confirm\`, { method: 'POST' });
        reviewedCount++;
        confirmedCount++;
        updateStats();
        await loadNext();
      } catch (error) {
        console.error('Failed to confirm:', error);
      }
    }

    async function reject() {
      if (!currentLink) return;

      try {
        await fetch(\`/api/links/\${currentLink.id}/reject\`, { method: 'POST' });
        reviewedCount++;
        rejectedCount++;
        updateStats();
        await loadNext();
      } catch (error) {
        console.error('Failed to reject:', error);
      }
    }

    function updateStats() {
      document.getElementById('stat-reviewed').textContent = reviewedCount;
      document.getElementById('stat-confirmed').textContent = confirmedCount;
      document.getElementById('stat-rejected').textContent = rejectedCount;
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'y' || e.key === 'Y') {
        confirm();
      } else if (e.key === 'n' || e.key === 'N') {
        reject();
      } else if (e.key === ' ') {
        e.preventDefault();
        loadNext();
      }
    });

    // Load first link
    loadNext();
  </script>
</body>
</html>
  `);
});

// Get next link for review
app.get('/api/links', async (_req, res) => {
  try {
    const link = await prisma.marketLink.findFirst({
      where: {
        status: 'suggested',
        score: { gte: MIN_SCORE },
        topic: { not: 'all' },
      },
      orderBy: { score: 'desc' },
      take: 1,
      include: {
        leftMarket: {
          include: {
            outcomes: true,
          },
        },
        rightMarket: {
          include: {
            outcomes: true,
          },
        },
      },
    });

    if (!link) {
      return res.json({});
    }

    return res.json({
      id: link.id,
      score: link.score,
      topic: link.topic,
      algoVersion: link.algoVersion,
      reason: link.reason,
      leftMarket: {
        id: link.leftMarket.id,
        title: link.leftMarket.title,
        status: link.leftMarket.status,
        outcomesCount: link.leftMarket.outcomes.length,
      },
      rightMarket: {
        id: link.rightMarket.id,
        title: link.rightMarket.title,
        status: link.rightMarket.status,
        outcomesCount: link.rightMarket.outcomes.length,
      },
    });
  } catch (error) {
    console.error('Failed to fetch link:', error);
    return res.status(500).json({ error: 'Failed to fetch link' });
  }
});

// Get stats
app.get('/api/stats', async (_req, res) => {
  try {
    const remaining = await prisma.marketLink.count({
      where: {
        status: 'suggested',
        score: { gte: MIN_SCORE },
        topic: { not: 'all' },
      },
    });

    res.json({ remaining });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Confirm link
app.post('/api/links/:id/confirm', async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);

    await prisma.marketLink.update({
      where: { id: linkId },
      data: {
        status: 'confirmed',
        reason: 'manual_review@3.1.0:web_ui',
      },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to confirm link:', error);
    res.status(500).json({ error: 'Failed to confirm link' });
  }
});

// Reject link
app.post('/api/links/:id/reject', async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);

    await prisma.marketLink.update({
      where: { id: linkId },
      data: {
        status: 'rejected',
        reason: 'manual_review@3.1.0:web_ui',
      },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to reject link:', error);
    res.status(500).json({ error: 'Failed to reject link' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=======================================================`);
  console.log(`🔗 Market Link Review Server (v3.1.0)`);
  console.log(`=======================================================`);
  console.log(`\nOpen in browser: http://192.168.1.250:${PORT}`);
  console.log(`Min Score: ${MIN_SCORE}`);
  console.log(`Batch Limit: ${LIMIT}`);
  console.log(`\nKeyboard shortcuts:`);
  console.log(`  Y = Confirm`);
  console.log(`  N = Reject`);
  console.log(`  Space = Skip`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
