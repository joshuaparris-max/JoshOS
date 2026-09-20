/* Josh OS built-in apps.
 *
 * Each app is a plain object: identity, default window size, and a mount()
 * that fills a window body. No app touches the window manager directly —
 * that boundary is the whole point, and it is the one to keep when this
 * moves to real processes talking to a real compositor.
 */

(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function api(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (options.body) options.headers['Content-Type'] = 'application/json';
    return fetch(path, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.message || ('HTTP ' + response.status));
        return data;
      });
    });
  }

  /* ---------- About ---------- */

  JoshOS.registerApp({
    id: 'about',
    name: 'About Josh OS',
    glyph: '\u25C8',
    width: 460,
    height: 300,
    mount: function (body) {
      var wrap = el('div', 'app');
      wrap.appendChild(el('h2', null, 'Josh OS'));
      wrap.appendChild(el('p', null,
        'A desktop built on the idea that a system should feel simpler after you understand it, not more complicated.'));
      wrap.appendChild(el('p', null,
        'This is the shell prototype: the window system, visual language and interaction model, running in a browser so they can be argued about before any of it is written in Rust.'));
      var r = el('div', 'row');
      r.appendChild(el('span', 'muted', 'Stage 0 — bootable shell prototype'));
      r.appendChild(el('span', 'muted', 'v0.1.0'));
      wrap.appendChild(r);
      body.appendChild(wrap);
    }
  });

  /* ---------- App Store ---------- */

  JoshOS.registerApp({
    id: 'store',
    name: 'App Store',
    glyph: '\u2692',
    width: 620,
    height: 420,
    mount: function (body) {
      var wrap = el('div', 'app');
      var list = el('div', 'store-list');
      wrap.appendChild(el('h2', null, 'App Store'));
      wrap.appendChild(el('p', 'muted', 'Curated Linux apps run through Flatpak. Windows apps run in managed Wine prefixes.'));
      wrap.appendChild(list);
      body.appendChild(wrap);

      function showMessage(message) {
        list.innerHTML = '';
        list.appendChild(el('p', 'muted', message));
      }

      function load() {
        showMessage('Loading catalog...');
        api('/api/apps/catalog').then(function (catalog) {
          list.innerHTML = '';
          (catalog.apps || []).forEach(function (app) {
            var row = el('div', 'row store-item');
            var copy = el('div');
            copy.appendChild(el('strong', null, app.name));
            copy.appendChild(el('div', 'muted', app.summary));
            row.appendChild(copy);
            var actions = el('div', 'row');
            var action = el('button', null, app.installed ? 'Open' : (app.runtime === 'wine' ? 'Install .exe' : 'Install'));
            action.disabled = app.installable === false;
            action.onclick = function () {
              action.disabled = true;
              action.textContent = 'Working...';
              if (app.installed) {
                api('/api/apps/launch', { method: 'POST', body: JSON.stringify({ id: app.id }) })
                  .then(function (result) { JoshOS.notify('App Store', result.message); load(); })
                  .catch(function (error) { JoshOS.notify('App Store', error.message); load(); });
                return;
              }
              var endpoint = app.installed ? '/api/apps/uninstall' : '/api/apps/install';
              var filename = app.runtime === 'wine' && !app.installed ? window.prompt('Enter the .exe filename in Downloads') : null;
              var executable = app.runtime === 'wine' && !app.installed ? window.prompt('Enter the installed .exe path, for example Program Files\\App\\app.exe') : null;
              if (app.runtime === 'wine' && !filename) { action.disabled = false; action.textContent = 'Install .exe'; return; }
              if (app.runtime === 'wine' && !executable) { action.disabled = false; action.textContent = 'Install .exe'; return; }
              api(endpoint, { method: 'POST', body: JSON.stringify({ id: app.id, filename: filename, executable: executable }) })
                .then(function (result) { JoshOS.notify('App Store', result.message); load(); })
                .catch(function (error) { JoshOS.notify('App Store', error.message); load(); });
            };
            actions.appendChild(action);
            if (app.installed && app.runtime === 'flatpak') {
              var remove = el('button', null, 'Remove');
              remove.onclick = function () {
                remove.disabled = true;
                api('/api/apps/uninstall', { method: 'POST', body: JSON.stringify({ id: app.id }) })
                  .then(function (result) { JoshOS.notify('App Store', result.message); load(); })
                  .catch(function (error) { JoshOS.notify('App Store', error.message); load(); });
              };
              actions.appendChild(remove);
            }
            row.appendChild(actions);
            list.appendChild(row);
          });
          if (!catalog.apps || !catalog.apps.length) showMessage('No applications are available in this catalog.');
        }).catch(function (error) {
          showMessage('App Store is unavailable: ' + error.message);
        });
      }

      load();
    }
  });

  /* ---------- Files ---------- */

  var FS = {
    Home: [
      { n: 'Documents', t: 'dir' },
      { n: 'Downloads', t: 'dir' },
      { n: 'Pictures', t: 'dir' },
      { n: 'Projects', t: 'dir' },
      { n: 'notes.txt', t: 'file' }
    ],
    Documents: [{ n: 'roadmap.md', t: 'file' }, { n: 'budget.ods', t: 'file' }],
    Downloads: [{ n: 'josh-os.iso', t: 'file' }],
    Pictures: [{ n: 'wallpaper.png', t: 'file' }],
    Projects: [{ n: 'josh-os', t: 'dir' }, { n: 'shell.js', t: 'file' }],
    'josh-os': [{ n: 'README.md', t: 'file' }, { n: 'shell', t: 'dir' }]
  };

  JoshOS.registerApp({
    id: 'files',
    name: 'Files',
    glyph: '\u25F0',
    width: 620,
    height: 400,
    mount: function (body) {
      var layout = el('div', 'sidebar-layout');
      var side = el('nav', 'sidebar');
      var grid = el('div', 'file-grid');
      var current = 'Home';

      function draw() {
        grid.innerHTML = '';
        (FS[current] || []).forEach(function (item) {
          var tile = el('button', 'file-tile');
          tile.appendChild(el('div', 'glyph', item.t === 'dir' ? '\u25F1' : '\u25A4'));
          tile.appendChild(el('div', null, item.n));
          tile.ondblclick = function () {
            if (item.t === 'dir' && FS[item.n]) { current = item.n; draw(); markSidebar(); }
            else JoshOS.notify('Files', 'No handler registered for ' + item.n);
          };
          grid.appendChild(tile);
        });
      }

      function markSidebar() {
        [].forEach.call(side.children, function (b) {
          b.setAttribute('aria-current', b.textContent === current ? 'true' : 'false');
        });
      }

      ['Home', 'Documents', 'Downloads', 'Pictures', 'Projects'].forEach(function (name) {
        var b = el('button', 'sidebar-item', name);
        b.onclick = function () { current = name; draw(); markSidebar(); };
        side.appendChild(b);
      });

      layout.appendChild(side);
      layout.appendChild(grid);
      body.appendChild(layout);
      draw();
      markSidebar();
    }
  });

  /* ---------- Terminal (Windows Terminal, GNOME, macOS, Konsole) ---------- */

  JoshOS.registerApp({
    id: 'terminal',
    name: 'Terminal',
    glyph: '\u232B',
    width: 720,
    height: 440,
    mount: function (body) {
      var PROFILES = {
        winterm: {
          id: 'winterm',
          name: 'PowerShell',
          icon: '🪟',
          short: 'WinTerm',
          cls: 'profile-winterm',
          shell: 'powershell',
          banner: 'Windows Terminal (PowerShell 7.4.5)\nRunning on Josh OS kernel. PowerShell cmdlets & native Linux binaries available.\nType "help" for profiles or run any Linux/PowerShell command.',
          promptHtml: function (cwd) {
            return '<span class="prompt-ps">PS</span> <span class="prompt-path">' + (cwd || '/home/josh') + '</span>&gt; ';
          }
        },
        gnome: {
          id: 'gnome',
          name: 'GNOME Terminal',
          icon: '🐧',
          short: 'GNOME',
          cls: 'profile-gnome',
          shell: 'bash',
          banner: 'Welcome to Josh OS (Linux 6.10-arch1 x86_64)\nGNOME Terminal 3.52 (Bash) — Ubuntu/Fedora style host.\nType "help" or run any command.',
          promptHtml: function (cwd) {
            var displayPath = cwd === '/home/josh' ? '~' : (cwd || '~');
            return '<span class="prompt-user-gnome">josh@joshos</span>:<span class="prompt-path">' + displayPath + '</span>$ ';
          }
        },
        macos: {
          id: 'macos',
          name: 'macOS Terminal',
          icon: '🍎',
          short: 'macOS',
          cls: 'profile-macos',
          shell: 'zsh',
          banner: 'Last login: ' + new Date().toDateString() + ' on ttys001\nmacOS Terminal.app emulation (Zsh shell)\nType "help" or run any command.',
          promptHtml: function (cwd) {
            var displayPath = cwd === '/home/josh' ? '~' : (cwd || '~');
            return '<span class="prompt-user-macos">josh@Josh-MacBook</span> <span class="prompt-path">' + displayPath + '</span> % ';
          }
        },
        konsole: {
          id: 'konsole',
          name: 'Konsole',
          icon: '⚙️',
          short: 'Konsole',
          cls: 'profile-konsole',
          shell: 'bash',
          banner: 'KDE Konsole 24.05 (KDE Plasma 6.1)\nHardware-accelerated Linux terminal emulator.\nType "help" or run any command.',
          promptHtml: function (cwd) {
            var displayPath = cwd === '/home/josh' ? '~' : (cwd || '~');
            return '[<span class="prompt-user-konsole">josh@joshos</span> <span class="prompt-path">' + displayPath + '</span>]$ ';
          }
        }
      };

      var container = el('div', 'terminal');
      var topBar = el('div', 'terminal-bar');
      var tabsNav = el('div', 'terminal-tabs');
      var profileNav = el('div', 'terminal-profile-switcher');
      var viewport = el('div', 'terminal-viewport');

      var tabs = [];
      var activeTab = null;
      var nextTabId = 1;

      // Profile quick-switch buttons in top right
      ['winterm', 'gnome', 'macos', 'konsole'].forEach(function (profKey) {
        var prof = PROFILES[profKey];
        var btn = el('button', 'profile-pill', prof.icon + ' ' + prof.short);
        btn.title = 'Switch active tab to ' + prof.name;
        btn.onclick = function () {
          if (activeTab) {
            setTabProfile(activeTab, profKey);
          }
        };
        profileNav.appendChild(btn);
      });

      var addBtn = el('button', 'terminal-add-btn', '+');
      addBtn.title = 'Open New Tab (Click or right-click to choose profile)';
      addBtn.onclick = function () {
        createTab('winterm');
      };

      topBar.appendChild(tabsNav);
      topBar.appendChild(profileNav);
      container.appendChild(topBar);
      container.appendChild(viewport);
      body.appendChild(container);

      function createTab(profileKey) {
        var prof = PROFILES[profileKey] || PROFILES.winterm;
        var tab = {
          id: nextTabId++,
          profileKey: profileKey,
          title: prof.name,
          cwd: '/home/josh',
          lines: [],
          history: [],
          historyIdx: -1,
          contentDiv: el('div', 'term-tab-content')
        };

        // Welcome banner
        var bannerDiv = el('div', 'term-banner', prof.banner);
        tab.contentDiv.appendChild(bannerDiv);

        tabs.push(tab);
        renderTabs();
        selectTab(tab);
      }

      function renderTabs() {
        tabsNav.innerHTML = '';
        tabs.forEach(function (tab) {
          var prof = PROFILES[tab.profileKey];
          var tabEl = el('div', 'terminal-tab' + (tab === activeTab ? ' active' : ''));
          var label = el('span', 'tab-label', prof.icon + ' ' + tab.title);
          label.onclick = function () { selectTab(tab); };

          var closeBtn = el('span', 'terminal-tab-close', '×');
          closeBtn.title = 'Close tab';
          closeBtn.onclick = function (e) {
            e.stopPropagation();
            closeTab(tab);
          };

          tabEl.appendChild(label);
          if (tabs.length > 1) {
            tabEl.appendChild(closeBtn);
          }
          tabsNav.appendChild(tabEl);
        });
        tabsNav.appendChild(addBtn);

        // Update active profile pills
        [].forEach.call(profileNav.children, function (pill, idx) {
          var key = ['winterm', 'gnome', 'macos', 'konsole'][idx];
          if (activeTab && activeTab.profileKey === key) {
            pill.classList.add('active');
          } else {
            pill.classList.remove('active');
          }
        });
      }

      function selectTab(tab) {
        activeTab = tab;
        var prof = PROFILES[tab.profileKey];
        viewport.className = 'terminal-viewport ' + prof.cls;
        viewport.innerHTML = '';
        viewport.appendChild(tab.contentDiv);

        // Render current input row
        renderInputRow(tab);
        renderTabs();
        scrollBottom();
      }

      function setTabProfile(tab, profileKey) {
        tab.profileKey = profileKey;
        var prof = PROFILES[profileKey];
        tab.title = prof.name;
        printToTab(tab, '\n[Switched to ' + prof.name + ' mode]\n', 'term-stdout');
        selectTab(tab);
      }

      function closeTab(tab) {
        var idx = tabs.indexOf(tab);
        if (idx === -1) return;
        tabs.splice(idx, 1);
        if (activeTab === tab) {
          var next = tabs[idx] || tabs[idx - 1] || null;
          if (next) selectTab(next);
        } else {
          renderTabs();
        }
      }

      function printToTab(tab, text, cls) {
        var line = el('div', 'term-line ' + (cls || 'term-stdout'), text);
        tab.contentDiv.appendChild(line);
      }

      function scrollBottom() {
        viewport.scrollTop = viewport.scrollHeight;
      }

      function renderInputRow(tab) {
        var existingRow = tab.contentDiv.querySelector('.term-input-row');
        if (existingRow) existingRow.remove();

        var prof = PROFILES[tab.profileKey];
        var row = el('div', 'term-input-row');
        var promptSpan = el('span', 'term-prompt');
        promptSpan.innerHTML = prof.promptHtml(tab.cwd);

        var input = el('input', 'terminal-input');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocomplete', 'off');
        input.value = '';

        row.appendChild(promptSpan);
        row.appendChild(input);
        tab.contentDiv.appendChild(row);

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            var raw = input.value.trim();
            tab.history.push(input.value);
            tab.historyIdx = tab.history.length;

            // Print command line into tab history
            var line = el('div', 'term-line');
            line.innerHTML = prof.promptHtml(tab.cwd) + escapeHtml(input.value);
            tab.contentDiv.insertBefore(line, row);
            input.value = '';

            if (raw) {
              executeCommand(tab, raw);
            }
            scrollBottom();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (tab.history.length && tab.historyIdx > 0) {
              tab.historyIdx--;
              input.value = tab.history[tab.historyIdx] || '';
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (tab.historyIdx < tab.history.length - 1) {
              tab.historyIdx++;
              input.value = tab.history[tab.historyIdx] || '';
            } else {
              tab.historyIdx = tab.history.length;
              input.value = '';
            }
          } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            tab.contentDiv.innerHTML = '';
            renderInputRow(tab);
          }
        });

        setTimeout(function () { input.focus(); }, 30);
      }

      function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function executeCommand(tab, raw) {
        var prof = PROFILES[tab.profileKey];
        var parts = raw.split(/\s+/);
        var baseCmd = parts[0].toLowerCase();

        // Built-in terminal controls
        if (baseCmd === 'clear' || baseCmd === 'cls') {
          tab.contentDiv.innerHTML = '';
          renderInputRow(tab);
          return;
        }

        if (baseCmd === 'help') {
          var helpText = [
            'Josh OS Multi-Profile Terminal',
            '==============================',
            'Profiles available in tabs:',
            '  1. Windows Terminal (PowerShell / Cmd) — profile winterm',
            '  2. GNOME Terminal (Linux Bash)        — profile gnome',
            '  3. macOS Terminal (Zsh)                — profile macos',
            '  4. Konsole (KDE Plasma)               — profile konsole',
            '',
            'Built-in shortcuts & commands:',
            '  profile <name>     Switch active profile (winterm, gnome, macos, konsole)',
            '  clear, cls         Clear terminal screen',
            '  xrandr -s <res>    Change VM screen resolution (e.g. xrandr -s 1920x1080)',
            '  ls, dir, pwd       List files and view current directory',
            '  cd <dir>           Change working directory',
            '  help, about, apps  System information and installed applications',
            '',
            'All standard Linux/PowerShell commands execute live against the Josh OS kernel.'
          ].join('\n');
          printToTab(tab, helpText, 'term-stdout');
          renderInputRow(tab);
          return;
        }

        if (baseCmd === 'profile' && parts[1]) {
          var targetProf = parts[1].toLowerCase();
          if (PROFILES[targetProf]) {
            setTabProfile(tab, targetProf);
          } else {
            printToTab(tab, 'Unknown profile: ' + parts[1] + '. Available: winterm, gnome, macos, konsole', 'term-stderr');
            renderInputRow(tab);
          }
          return;
        }

        if (baseCmd === 'about') {
          printToTab(tab, 'Josh OS Stage 0 live integration release with unified shell & multi-terminal host.', 'term-stdout');
          renderInputRow(tab);
          return;
        }

        if (baseCmd === 'apps') {
          printToTab(tab, JoshOS.apps().map(function (a) { return a.id; }).join('   '), 'term-stdout');
          renderInputRow(tab);
          return;
        }

        if (baseCmd === 'open' && parts[1]) {
          JoshOS.openApp(parts[1]);
          printToTab(tab, 'Opening ' + parts[1] + '...', 'term-stdout');
          renderInputRow(tab);
          return;
        }

        // Send to real backend
        api('/api/terminal/exec', {
          method: 'POST',
          body: JSON.stringify({
            command: raw,
            cwd: tab.cwd,
            shell: prof.shell
          })
        }).then(function (res) {
          if (res.cwd) tab.cwd = res.cwd;
          if (res.stdout) printToTab(tab, res.stdout, 'term-stdout');
          if (res.stderr) printToTab(tab, res.stderr, 'term-stderr');
          renderInputRow(tab);
          scrollBottom();
        }).catch(function (err) {
          // Offline / standalone fallback
          runLocalFallback(tab, raw);
          renderInputRow(tab);
          scrollBottom();
        });
      }

      function runLocalFallback(tab, raw) {
        var parts = raw.split(/\s+/);
        var base = parts[0].toLowerCase();
        if (base === 'ls' || base === 'dir' || base === 'gci' || base === 'get-childitem') {
          printToTab(tab, (FS.Home || []).map(function (f) { return f.n; }).join('   '), 'term-stdout');
        } else if (base === 'pwd' || base === 'gl' || base === 'get-location') {
          printToTab(tab, tab.cwd, 'term-stdout');
        } else if (base === 'echo' || base === 'write-host') {
          printToTab(tab, parts.slice(1).join(' '), 'term-stdout');
        } else if (base === 'date' || base === 'get-date') {
          printToTab(tab, new Date().toString(), 'term-stdout');
        } else if (base === 'uname' || base === 'uname -a') {
          printToTab(tab, 'Linux joshos 6.10.10-arch1 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux', 'term-stdout');
        } else if (base === 'xrandr') {
          printToTab(tab, 'Screen 0: minimum 320 x 200, current 1024 x 768, maximum 8192 x 8192\nVirtual-1 connected primary 1024x768+0+0\n   1920x1080     60.00 +\n   1600x900      60.00\n   1366x768      60.00\n   1024x768      60.00*', 'term-stdout');
        } else {
          printToTab(tab, base + ': command not found. (Backend offline. Type "help")', 'term-stderr');
        }
      }

      viewport.addEventListener('click', function () {
        var input = viewport.querySelector('.terminal-input');
        if (input) input.focus();
      });

      // Start initial default tab
      createTab('winterm');
    }
  });

  /* ---------- Text editor ---------- */

  JoshOS.registerApp({
    id: 'editor',
    name: 'Text Editor',
    glyph: '\u270E',
    width: 520,
    height: 380,
    mount: function (body) {
      var ta = el('textarea', 'editor');
      ta.spellcheck = false;
      ta.value = '# notes\n\nJosh OS should feel simpler after you understand it,\nnot more complicated.\n';
      body.appendChild(ta);
    }
  });

  /* ---------- Settings ---------- */

  JoshOS.registerApp({
    id: 'settings',
    name: 'Settings',
    glyph: '\u2699',
    width: 480,
    height: 360,
    mount: function (body) {
      var wrap = el('div', 'app');

      wrap.appendChild(el('h2', null, 'Appearance'));

      var themeRow = el('div', 'row');
      themeRow.appendChild(el('span', null, 'Theme'));
      var themeBtns = el('div');
      ['light', 'dark'].forEach(function (mode) {
        var b = el('button', 'btn ghost', mode);
        b.style.marginLeft = '8px';
        b.onclick = function () { JoshOS.setTheme(mode); };
        themeBtns.appendChild(b);
      });
      themeRow.appendChild(themeBtns);
      wrap.appendChild(themeRow);

      var accentRow = el('div', 'row');
      accentRow.appendChild(el('span', null, 'Accent'));
      var sw = el('div', 'swatches');
      ['#48c39f', '#5aa9e6', '#dda43c', '#d9738f', '#9a8cd6'].forEach(function (hex) {
        var b = el('button', 'swatch');
        b.style.background = hex;
        b.onclick = function () {
          JoshOS.setAccent(hex);
          [].forEach.call(sw.children, function (c) { c.setAttribute('aria-current', c === b ? 'true' : 'false'); });
        };
        sw.appendChild(b);
      });
      accentRow.appendChild(sw);
      wrap.appendChild(accentRow);

      var wallRow = el('div', 'row');
      wallRow.appendChild(el('span', null, 'Wallpaper'));
      var wallBtns = el('div');
      Object.keys(JoshOS.wallpapers).forEach(function (name) {
        var b = el('button', 'btn ghost', name);
        b.style.marginLeft = '6px';
        b.onclick = function () { JoshOS.setWallpaper(name); };
        wallBtns.appendChild(b);
      });
      wallRow.appendChild(wallBtns);
      wrap.appendChild(wallRow);

      wrap.appendChild(el('h2', null, 'Network'));
      var networkStatus = el('p', 'network-status', 'Checking network…');
      var networkControls = el('div', 'network-controls');
      var networkSelect = el('select', 'field');
      var password = el('input', 'field');
      password.type = 'password';
      password.placeholder = 'Wi-Fi password';
      password.autocomplete = 'current-password';

      var refresh = el('button', 'btn ghost', 'Scan');
      var connect = el('button', 'btn', 'Connect');
      var disconnect = el('button', 'btn ghost', 'Disconnect');
      var radio = el('button', 'btn ghost', 'Wi-Fi on/off');

      networkControls.appendChild(networkSelect);
      networkControls.appendChild(password);
      networkControls.appendChild(connect);
      networkControls.appendChild(refresh);
      networkControls.appendChild(disconnect);
      networkControls.appendChild(radio);
      wrap.appendChild(networkStatus);
      wrap.appendChild(networkControls);

      function unavailable(err) {
        networkStatus.textContent = 'Network controls are available in the booted Josh OS image. ' +
          (err && err.message ? err.message : '');
        networkSelect.innerHTML = '';
        [password, connect, refresh, disconnect, radio].forEach(function (control) {
          control.disabled = true;
        });
      }

      function loadStatus() {
        return api('/api/network/status').then(function (status) {
          var connection = status.connection || 'not connected';
          networkStatus.textContent =
            'State: ' + status.state + ' · Internet: ' + status.connectivity +
            ' · Wi-Fi: ' + status.wifi_radio + ' · ' + connection;
          radio.textContent = status.wifi_radio === 'enabled' ? 'Turn Wi-Fi off' : 'Turn Wi-Fi on';
          return status;
        });
      }

      function scan() {
        refresh.disabled = true;
        return api('/api/network/wifi').then(function (data) {
          networkSelect.innerHTML = '';
          if (!data.networks.length) {
            var empty = el('option', null, 'No Wi-Fi networks found');
            empty.value = '';
            networkSelect.appendChild(empty);
          } else {
            data.networks.forEach(function (network) {
              var option = el('option', null,
                network.ssid + ' · ' + network.signal + '% · ' + network.security);
              option.value = network.ssid;
              option.dataset.security = network.security;
              networkSelect.appendChild(option);
            });
          }
        }).finally(function () {
          refresh.disabled = false;
        });
      }

      refresh.onclick = function () {
        scan().then(loadStatus).catch(unavailable);
      };

      connect.onclick = function () {
        var ssid = networkSelect.value;
        if (!ssid) return;
        connect.disabled = true;
        networkStatus.textContent = 'Connecting to ' + ssid + '…';
        api('/api/network/connect', {
          method: 'POST',
          body: JSON.stringify({ ssid: ssid, password: password.value })
        }).then(function (result) {
          password.value = '';
          JoshOS.notify('Network', result.message || ('Connected to ' + ssid));
          return loadStatus();
        }).then(scan).catch(function (err) {
          networkStatus.textContent = 'Connection failed: ' + err.message;
        }).finally(function () {
          connect.disabled = false;
        });
      };

      disconnect.onclick = function () {
        api('/api/network/disconnect', { method: 'POST', body: '{}' })
          .then(function (result) {
            JoshOS.notify('Network', result.message || 'Disconnected');
            return loadStatus();
          }).catch(function (err) {
            networkStatus.textContent = 'Disconnect failed: ' + err.message;
          });
      };

      radio.onclick = function () {
        var turnOn = radio.textContent.indexOf('on') !== -1;
        api('/api/network/wifi-radio', {
          method: 'POST',
          body: JSON.stringify({ enabled: turnOn })
        }).then(function () {
          return loadStatus();
        }).then(scan).catch(function (err) {
          networkStatus.textContent = 'Wi-Fi control failed: ' + err.message;
        });
      };

      Promise.all([loadStatus(), scan()]).catch(unavailable);

      wrap.appendChild(el('h2', null, 'System'));
      wrap.appendChild(el('p', null,
        'Stage 0 uses real NetworkManager-backed controls when booted from the Josh OS image. Other hardware settings remain absent until they have real implementations.'));

      body.appendChild(wrap);
    }
  });

  /* ---------- boot once the DOM is ready ---------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', JoshOS.boot);
  } else {
    JoshOS.boot();
  }
})();
