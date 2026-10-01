export function parseCommand(input, owner = '') {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new Error('Enter 1–2000 characters.');
  const text = input.trim().replace(/^!bro\s+/i, '').replace(/^@?brobot[:,]?\s+/i, '').trim();
  const [word, ...parts] = text.split(/\s+/);
  const rest = parts.join(' ');
  switch (word.toLowerCase()) {
    case 'stop': case 'pause': return { kind: 'stop' };
    case 'status': case 'inventory': case 'help': return { kind: word.toLowerCase() };
    case 'follow': return { kind: 'follow', player: rest === 'me' || !rest ? owner : rest };
    case 'come': return { kind: 'come', player: rest === 'here' || rest === 'me' || !rest ? owner : rest };
    case 'remember': return { kind: 'waypoint', name: rest || 'home' };
    case 'home': return { kind: 'waypoint_go', name: 'home' };
    case 'goto': {
      if (parts.length === 1) return { kind: 'waypoint_go', name: rest };
      if (parts.length !== 3 || parts.some(p => !Number.isFinite(Number(p)))) throw new Error('Use goto x y z, or goto waypoint.');
      return { kind: 'coordinates', x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
    }
    case 'action': {
      const match = text.match(/^action\s+([a-z_]+)(?:\s+([\s\S]+))?$/i);
      if (!match) throw new Error('Use action name {"argument":"value"}.');
      let args;
      try { args = JSON.parse(match[2] || '{}'); } catch { throw new Error('Action arguments must be JSON.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Action arguments must be an object.');
      return { kind: 'action', name: match[1], args };
    }
    case 'survive': {
      if (!['starter', 'resume'].includes(rest.toLowerCase())) throw new Error('Use survive starter, or survive resume.');
      return { kind: 'survival', resume: rest.toLowerCase() === 'resume' };
    }
    case 'goal': return { kind: 'goal', text: rest, persistent: true };
    case 'ask': return { kind: 'goal', text: rest, persistent: false };
    default: return { kind: 'goal', text };
  }
}

export function authorizedChat(username, message, owner, botName) {
  return Boolean(owner && username.toLowerCase() === owner.toLowerCase() && username.toLowerCase() !== botName.toLowerCase() && /^(?:!bro\b|@?brobot\b)/i.test(message));
}

export const HELP = 'Chat naturally with AI, or use stop, status, inventory, follow NAME, come NAME, goto X Y Z, remember home, home, survive starter, survive resume, or action NAME {JSON}. In-game: !bro <message>. Follow lasts one minute; use an AI goal for longer companionship. Actions and their arguments are listed in the dashboard.';
