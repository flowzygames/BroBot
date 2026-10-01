const choices = {
  windows: { title: 'Windows · open the launcher', command: 'Start-BroBot.cmd', detail: 'Extract the ZIP first, then double-click Start-BroBot.cmd inside the folder. If Node.js is missing, install it from the official Node.js site and reopen the launcher.', connection: 'Java: 127.0.0.1:25565 · Bedrock: 127.0.0.1, port 19132' },
  mac: { title: 'macOS · start from Terminal', command: 'sh start-brobot.sh', detail: 'Extract the ZIP. Open Terminal in that extracted folder, then run this command. The launcher checks dependencies and opens setup before starting the server.', connection: 'Java: 127.0.0.1:25565 · Minecraft Java client required on macOS' },
  linux: { title: 'Linux · start from your terminal', command: 'sh start-brobot.sh', detail: 'Extract the ZIP and open a terminal in that folder. Run this command with Node.js 22.9 or newer installed. The launcher handles the remaining setup prompts.', connection: 'Java: 127.0.0.1:25565 · Minecraft Java client required on Linux' }
};
const root = document.querySelector('#platformGuide');
if (root) {
  let selected = 'windows', generation = 0;
  const code = root.querySelector('#platformCommand'), copy = root.querySelector('#copyPlatform');
  function select(platform) {
    if (!choices[platform]) return;
    selected = platform; generation++;
    const choice = choices[platform];
    root.querySelector('#platformTitle').textContent = choice.title;
    code.textContent = choice.command;
    root.querySelector('#platformDetail').textContent = choice.detail;
    root.querySelector('#platformConnection').textContent = choice.connection;
    copy.textContent = 'Copy launcher command';
    root.querySelector('#platformStatus').textContent = '';
    root.querySelectorAll('[data-platform]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.platform === selected)));
  }
  root.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => select(button.dataset.platform)));
  copy.addEventListener('click', async () => {
    const request = generation, command = choices[selected].command;
    try {
      await navigator.clipboard.writeText(command);
      if (request === generation) root.querySelector('#platformStatus').textContent = 'Copied. Run it only in your extracted BroBot folder.';
    } catch {
      if (request === generation) root.querySelector('#platformStatus').textContent = 'Clipboard unavailable. Select and copy the command above.';
    }
  });
  select(selected);
}
