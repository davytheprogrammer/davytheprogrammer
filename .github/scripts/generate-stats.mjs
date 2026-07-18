// Pulls live GitHub stats via GraphQL and renders a self-hosted, on-brand
// stats panel. Avoids depending on third-party stats-card deployments,
// which periodically go down (rate limits / paused hobby deployments).
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = process.env.STATS_LOGIN;
const TOKEN = process.env.GITHUB_TOKEN;

if (!LOGIN || !TOKEN) {
  console.error("Missing STATS_LOGIN or GITHUB_TOKEN");
  process.exit(1);
}

const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date } }
        }
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          stargazerCount
          primaryLanguage { name color }
        }
      }
      followers { totalCount }
    }
  }
`;

async function main() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${await res.text()}`);
  }

  const { data, errors } = await res.json();
  if (errors) throw new Error(JSON.stringify(errors));

  const user = data.user;
  const days = user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ count: d.contributionCount, date: d.date }));

  const totalContributions =
    user.contributionsCollection.contributionCalendar.totalContributions;

  // streaks
  let longest = 0;
  let running = 0;
  for (const d of days) {
    if (d.count > 0) {
      running++;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const isToday = i === days.length - 1;
    if (days[i].count > 0) {
      current++;
    } else if (isToday) {
      continue; // today may not have contributions yet, don't break the streak
    } else {
      break;
    }
  }

  const totalStars = user.repositories.nodes.reduce(
    (sum, r) => sum + r.stargazerCount,
    0
  );
  const totalRepos = user.repositories.totalCount;
  const followers = user.followers.totalCount;

  const langTally = new Map();
  for (const r of user.repositories.nodes) {
    if (!r.primaryLanguage) continue;
    const key = r.primaryLanguage.name;
    const prev = langTally.get(key);
    langTally.set(key, {
      count: (prev?.count || 0) + 1,
      color: r.primaryLanguage.color || "#00f7ff",
    });
  }
  const totalLangRepos = [...langTally.values()].reduce((s, v) => s + v.count, 0) || 1;
  const topLangs = [...langTally.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, v]) => ({
      name,
      color: v.color,
      pct: Math.round((v.count / totalLangRepos) * 100),
    }));

  const svg = renderSvg({
    totalContributions,
    current,
    longest,
    totalStars,
    totalRepos,
    followers,
    topLangs,
  });

  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/stats.svg", svg);
  console.log("Wrote dist/stats.svg");
}

function tile(x, label, value, accent) {
  return `
    <g transform="translate(${x},0)">
      <rect width="286" height="120" rx="10" fill="#0b0f1a" stroke="${accent}" stroke-opacity="0.35"/>
      <text x="20" y="34" font-size="11" letter-spacing="2" fill="${accent}" opacity="0.85">${label}</text>
      <text x="20" y="80" font-size="34" font-weight="800" fill="#eafcff" filter="url(#glow)">${value}</text>
    </g>`;
}

function langBar(y, lang, index) {
  const width = 720;
  const fillWidth = (lang.pct / 100) * width;
  return `
    <g transform="translate(0,${y})">
      <text x="0" y="12" font-size="12" fill="#d8f6ff">${escapeXml(lang.name)}</text>
      <text x="${width}" y="12" font-size="12" fill="#8be9ff" text-anchor="end">${lang.pct}%</text>
      <rect x="0" y="20" width="${width}" height="10" rx="5" fill="#111826"/>
      <rect x="0" y="20" width="${fillWidth}" height="10" rx="5" fill="${lang.color}" style="animation: grow${index} 1.2s ease forwards; transform-box: fill-box; transform-origin: left;"/>
    </g>`;
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function renderSvg({ totalContributions, current, longest, totalStars, totalRepos, followers, topLangs }) {
  const langKeyframes = topLangs
    .map(
      (l, i) => `@keyframes grow${i} { from { transform: scaleX(0); } to { transform: scaleX(1); } }`
    )
    .join("\n");

  const totalHeight = 225 + topLangs.length * 38;

  return `<svg viewBox="0 0 940 ${totalHeight}" xmlns="http://www.w3.org/2000/svg" font-family="Consolas, 'Courier New', monospace">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style><![CDATA[
      ${langKeyframes}
    ]]></style>
  </defs>
  <rect width="940" height="${totalHeight}" rx="14" fill="#05070d"/>
  <g transform="translate(20,20)">
    ${tile(0, "TOTAL CONTRIBUTIONS (365d)", totalContributions, "#00f7ff")}
    ${tile(306, "CURRENT / LONGEST STREAK", `${current}d / ${longest}d`, "#00ff88")}
    ${tile(612, "STARS EARNED", totalStars, "#ff2e9a")}
  </g>
  <g transform="translate(20,155)" font-size="11" letter-spacing="2" fill="#7fd9ff" opacity="0.8">
    <text x="0" y="0">PUBLIC REPOS: ${totalRepos}   ·   FOLLOWERS: ${followers}</text>
  </g>
  <g transform="translate(20,185)">
    <text x="0" y="0" font-size="12" letter-spacing="2" fill="#00f7ff" opacity="0.9">TOP LANGUAGES</text>
    <g transform="translate(0,20)">
      ${topLangs.map((l, i) => langBar(i * 38, l, i)).join("\n")}
    </g>
  </g>
</svg>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
