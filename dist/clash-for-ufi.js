<script>
// Clash for UFI v1.4.2
(() => {
 // Do not render a second copy if a damaged custom_head contains this plugin twice.
 if (window.__CLASH_FOR_UFI_LOADED__) return;
 window.__CLASH_FOR_UFI_LOADED__ = true;

 const PLUGIN_INFO = Object.freeze({
  name: 'Clash for UFI',
  version: '1.4.2',
  updateApiUrl: 'https://api.github.com/repos/lack9921/UFI-TOOLS/contents/plugins/ufi-proxy-studio/dist/Clash-for-UFI.txt?ref=main',
  updateUrl: 'https://raw.githubusercontent.com/lack9921/UFI-TOOLS/refs/heads/main/plugins/ufi-proxy-studio/dist/Clash-for-UFI.txt',
  updateProxyUrl: 'https://github.com/lack9921/UFI-TOOLS/raw/refs/heads/main/plugins/ufi-proxy-studio/dist/Clash-for-UFI.txt',
 });
 const checkAdvanceFunc = async () => {
 const res = await runShellWithRoot('whoami');
 if (res.content) {
 if (res.content.includes('root')) {
 return true;
 }
 }
 return false;
 };

 const createRandomString = (length = 8) => {
 const characters =
 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
 let result = '';
 for (let i = 0; i < length; i++) {
 result += characters.charAt(
 Math.floor(Math.random() * characters.length),
 );
 }
 return result;
 };

 const yamlQuote = (value) => JSON.stringify(String(value ?? ''));

 const getControllerSecret = () => {
  const key = 'ufi_proxy_studio_controller_secret';
  const legacyKeys = ['ufi_mihomo_studio_controller_secret', 'elvisjp_mihomo_controller_secret'];
  let secret = localStorage.getItem(key) || legacyKeys.map((legacyKey) => localStorage.getItem(legacyKey)).find(Boolean);
  if (!secret || secret.length < 24) {
   const bytes = new Uint8Array(24);
   crypto.getRandomValues(bytes);
   secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
   }
   localStorage.setItem(key, secret);
   return secret;
 };

 const SETTINGS_KEY = 'ufi_proxy_studio_settings_v1';
 const LEGACY_SETTINGS_KEYS = ['ufi_mihomo_studio_settings_v1', 'elvisjp_mihomo_plugin_settings_v3'];
 const DEFAULT_SETTINGS = Object.freeze({
  mode: 'tproxy',
  tunStack: 'mixed',
  mtu: 1500,
  fakeIpRange: '198.18.0.1/16',
  controllerPort: 7788,
  controllerAuth: true,
  panelOpacity: 0.68,
  sniffer: true,
  processMode: 'off',
 });

 const loadPluginSettings = () => {
  try {
   const storedText = localStorage.getItem(SETTINGS_KEY)
    || LEGACY_SETTINGS_KEYS.map((legacyKey) => localStorage.getItem(legacyKey)).find(Boolean)
    || '{}';
   const stored = JSON.parse(storedText);
   const settings = { ...DEFAULT_SETTINGS, ...stored };
   settings.mode = settings.mode === 'tun' ? 'tun' : 'tproxy';
   settings.tunStack = ['mixed', 'system', 'gvisor'].includes(settings.tunStack)
    ? settings.tunStack
    : 'mixed';
   settings.mtu = Math.min(9000, Math.max(1280, Number(settings.mtu) || 1500));
   settings.controllerPort = Math.min(65535, Math.max(1024, Number(settings.controllerPort) || 7788));
   settings.panelOpacity = Math.min(1, Math.max(0.25, Number(settings.panelOpacity) || 0.68));
   settings.fakeIpRange = String(settings.fakeIpRange || DEFAULT_SETTINGS.fakeIpRange).trim();
   settings.controllerAuth = settings.controllerAuth !== false;
   settings.processMode = ['off', 'strict', 'always'].includes(settings.processMode)
    ? settings.processMode
    : 'off';
   settings.sniffer = settings.sniffer !== false;
   return settings;
  } catch (_) {
   return { ...DEFAULT_SETTINGS };
  }
 };

 const savePluginSettings = (settings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
 };

 const panelStyle = (settings = loadPluginSettings()) =>
  `pointer-events:all;width:90vw;max-width:680px;padding:16px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:transparent;backdrop-filter:blur(14px);box-shadow:0 16px 50px rgba(0,0,0,.45);`;

 /**
  * UFI-TOOLS 的 runShellWithRoot.success 只代表 API 调用成功。
  * 这里额外回传 shell 退出码，避免命令失败后仍显示成功。
  */
 const runRootChecked = async (command, timeout = 10000) => {
   const marker = `__UFI_STUDIO_EXIT_${createRandomString(12)}__`;
  const wrapped = `
(
set -e
${command}
)
code=$?
echo "${marker}:$code"
`;
  const res = await runShellWithRoot(wrapped, timeout);
  if (!res.success) return res;
  const content = String(res.content || '');
  const match = content.match(new RegExp(`${marker}:(\\d+)`));
  if (!match) {
   return { success: false, content: `命令未返回退出码：${content}` };
  }
  const exitCode = Number(match[1]);
  return {
   success: exitCode === 0,
   exitCode,
   content: content.replace(new RegExp(`\\n?${marker}:\\d+\\s*$`), '').trim(),
  };
 };

 // Unified Clash for UFI bridge via /data/clash/Scripts/debug_service.sh
 const PLUGIN_VERSION = '2.1.1';
 const PLUGIN_REPO = 'lack9921/UFI-Proxy-Studio';
 const runSubscriptionBridge = async (action, _argument = '') => {
  if (action === 'status') {
   const localState = await localCurrentSubscriptionState();
   const svc = await runShellWithRoot('/data/clash/Scripts/debug_service.sh status 2>/dev/null || echo "{}"', 8000);
   let svcJson = {};
   try { svcJson = JSON.parse((svc.content || '').trim()); } catch (_) {}
   if (localState === 'RECORDED') {
    return { ok: true, data: { enabled: true, status: 'bound', debugRunning: !!svcJson.running, port: svcJson.port || 17789 } };
   }
   return {
    ok: true,
    data: {
     enabled: false,
     reasonCode: localState === 'AMBIGUOUS' ? 'CURRENT_SOURCE_AMBIGUOUS' : 'UNBOUND',
     migrationRequired: localState !== 'AMBIGUOUS',
    },
   };
  }
  if (action === 'refresh') {
   const res = await runRootChecked('/data/clash/Scripts/debug_service.sh refresh', 45000);
   if (!res.success) throw new Error(res.content || '刷新失败');
   let data = {};
   try { data = JSON.parse(res.content); } catch (_) { throw new Error('刷新返回格式无效'); }
   if (!data.ok) throw new Error(data.error || '刷新失败');
   return { ok: true, data: { status: 'applied', config_sha256: data.config_sha256 || '' } };
  }
  if (action === 'check' || action === 'bind') {
   return await runSubscriptionBridge('status');
  }
  throw new Error('桥接动作不受支持');
 };

 const createPluginToast = (id, html, style = {}) => {
  const settings = loadPluginSettings();
  return createFixedToast(id, html, {
   backgroundColor: `rgba(13,17,23,${settings.panelOpacity})`,
   backdropFilter: 'blur(14px)',
   border: '1px solid rgba(255,255,255,.14)',
   ...style,
  });
 };

 const isMMRunning = async () => {
 const status = await runShellWithRoot('pgrep Clash');
 const running_mm = document.querySelector('#running_mm');
 const isR =
 status.content != null &&
 status.content != undefined &&
 status.content != '';
 if (running_mm) {
 running_mm.innerHTML = isR ? 'Clash for UFI · Mihomo 🟢运行中' : 'Clash for UFI · Mihomo 🔴已停止';
 }
 return isR;
 };

 async function isELF(file) {
 const blob = file.slice(0, 4);
 const buffer = await blob.arrayBuffer();
 const bytes = new Uint8Array(buffer);
 return (
 bytes[0] === 0x7f &&
 bytes[1] === 0x45 &&
 bytes[2] === 0x4c &&
 bytes[3] === 0x46
 );
 }

 const askConfirm = (id, title, body, ok = '确认', cancel = '取消') => new Promise((resolve) => {
 const { el, close } = createPluginToast(
 id,
 `<div style="pointer-events:all;width:90vw;max-width:520px;">
 <div class="title" style="margin:0">${title}</div>
 <div style="margin-top:10px;font-size:.7rem;line-height:1.75">${body}</div>
 <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
 <button class="ok">${ok}</button>
 <button class="cancel">${cancel}</button>
 </div>
 </div>`,
 );
 const done = (value) => {
 close();
 resolve(value);
 };
 el.querySelector('.ok')?.addEventListener('click', () => done(true));
 el.querySelector('.cancel')?.addEventListener('click', () => done(false));
 });

 const checkIsBootUp = async () => {
 const res = await runShellWithRoot(`
 grep -q '/data/clash/Scripts/Clash.Service start' /sdcard/ufi_tools_boot.sh
 echo $?
 `);
 return res.content.trim() == '0';
 };

 const checkIsInstalled = async () => {
 const res = await runShellWithRoot(`
 ls /data/clash/Scripts/Clash.Service
 `);
 return res.success && res.content && res.content.includes('Clash.Service');
 };

 const saveConfig = async (file, { validate = true } = {}) => {
  try {
 const formData = new FormData();
 formData.append('file', file);
 const res = await (
 await fetch(`${KANO_baseURL}/upload_img`, {
 method: 'POST',
 headers: common_headers,
 body: formData,
 })
 ).json();

  if (res.url) {
  const uploadedPath = `/data/data/com.minikano.f50_sms/files/${res.url}`;
  const validationCommand = validate
   ? `
  cd /data/clash/Proxy
  rm -f /data/clash/config-test.log
  if ! ./Clash.Core -t -d /data/clash/Proxy -f "$candidate" > /data/clash/config-test.log 2>&1; then
    cat /data/clash/config-test.log
    exit 20
  fi
  `
   : '';
  const resShell = await runRootChecked(`
  candidate=${JSON.stringify(uploadedPath)}
  target=/data/clash/Proxy/config.yaml
  backup=/data/clash/Proxy/config.yaml.ufi-proxy-studio-backup
  [ -f "$candidate" ] || { echo "上传后的配置不存在"; exit 10; }
  [ -x /data/clash/Proxy/Clash.Core ] || { echo "mihomo 内核不存在"; exit 11; }
  ${validationCommand}
  if [ -f "$target" ]; then
    cp -fp "$target" "$backup"
  fi
  mv -f "$candidate" "$target"
  chmod 600 "$target"
  if ! /data/clash/Scripts/Clash.Service stop >/dev/null 2>&1; then true; fi
  /data/clash/Scripts/Clash.Service start
  sleep 3
  if ! pgrep Clash >/dev/null 2>&1; then
    echo "新配置启动失败，正在回滚"
    if [ -f "$backup" ]; then
      cp -fp "$backup" "$target"
      /data/clash/Scripts/Clash.Service start >/dev/null 2>&1 || true
    fi
    exit 30
  fi
  echo "CONFIG_APPLIED"
  `, 100 * 1000);
  if (resShell.success && resShell.content.includes('CONFIG_APPLIED')) {
   createToast('配置已校验、备份并成功启动', 'green');
   isMMRunning();
   return true;
  }
  throw new Error(resShell.content || '配置应用失败');
  } else throw res.error || '';
  } catch (e) {
  console.error(e);
  createToast(`配置应用失败：${String(e?.message || e)}`, 'red', 8000);
  return false;
  }
 };

 const PROFILE_DIR = '/data/clash/Profiles';
 const PROFILE_MANIFEST = `${PROFILE_DIR}/manifest.json`;
  const CURRENT_SUBSCRIPTION_SOURCE = `${PROFILE_DIR}/current-subscription.source`;
  const CURRENT_SUBSCRIPTION_MARKER = `${PROFILE_DIR}/current-subscription.json`;
  const ACTIVE_CONFIG_PATH = '/data/clash/Proxy/config.yaml';

 const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

 const getPluginBlock = (text) => {
  const pattern = /<!--\s*\[KANO_PLUGIN_START\]\s*Clash for UFI\s*-->[\s\S]*?<!--\s*\[KANO_PLUGIN_END\]\s*Clash for UFI\s*-->/;
  return String(text || '').match(pattern)?.[0] || '';
 };

 const getPluginVersion = (text) =>
  String(text || '').match(/\/\/\s*Clash for UFI v([0-9A-Za-z.-]+)/)?.[1] || '';

 const fetchPluginUpdatePackage = async () => {
  const cacheBuster = `t=${Date.now()}`;
  const proxyDownload = await runRootChecked(`
  curl_bin=/data/data/com.minikano.f50_sms/files/curl
  if [ ! -x "$curl_bin" ]; then
    curl_bin=$(command -v curl 2>/dev/null || true)
  fi
  [ -n "$curl_bin" ] && [ -x "$curl_bin" ] || { echo "设备中找不到 curl"; exit 40; }
  config=/data/clash/Proxy/config.yaml
  proxy_port=$(sed -n 's/^[[:space:]]*mixed-port:[[:space:]]*\\([0-9][0-9]*\\).*$/\\1/p' "$config" | head -n 1)
  if [ -z "$proxy_port" ]; then
    proxy_port=$(sed -n 's/^[[:space:]]*port:[[:space:]]*\\([0-9][0-9]*\\).*$/\\1/p' "$config" | head -n 1)
  fi
  case "$proxy_port" in
    ''|*[!0-9]*) echo "配置中找不到 mixed-port/port"; exit 41 ;;
  esac
  "$curl_bin" --fail --silent --show-error --location --connect-timeout 15 --max-time 60 --proxy "http://127.0.0.1:$proxy_port" --header "Accept: application/vnd.github.raw" --header "User-Agent: UFI-Proxy-Studio" "${PLUGIN_INFO.updateApiUrl}&${cacheBuster}"
  `, 75 * 1000);
  if (proxyDownload.success) return proxyDownload.content;
  const candidates = [
   {
    label: 'UFI-TOOLS 代理',
    url: `${KANO_baseURL}/proxy/--${PLUGIN_INFO.updateProxyUrl}?${cacheBuster}`,
    options: { cache: 'no-store', headers: { ...common_headers } },
   },
   {
    label: 'GitHub 直连',
    url: `${PLUGIN_INFO.updateUrl}?${cacheBuster}`,
    options: { cache: 'no-store' },
   },
  ];
  const errors = [`Mihomo 本地代理: ${String(proxyDownload.content || '下载失败')}`];
  for (const candidate of candidates) {
   try {
    const response = await fetch(candidate.url, candidate.options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
   } catch (error) {
    errors.push(`${candidate.label}: ${String(error?.message || error)}`);
   }
  }
  throw new Error(errors.join('；'));
 };

 const checkPluginUpdate = async () => {
  createToast('正在检查 Clash for UFI 更新...', '');
  try {
   const remoteText = await fetchPluginUpdatePackage();
   if (remoteText.length < 1000 || remoteText.length > 1145 * 1024) throw new Error('远程插件大小异常');
   const remoteBlock = getPluginBlock(remoteText);
   const remoteVersion = getPluginVersion(remoteBlock);
   const openScriptTag = ['<', 'script', '>'].join('');
   const closeScriptTag = ['<', '/script', '>'].join('');
   const remoteBody = remoteBlock
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .replace(/\s*<!--\s*\[KANO_PLUGIN_END\][\s\S]*$/, '')
    .trim();
   if (!remoteBlock || !remoteVersion
    || !remoteBody.startsWith(openScriptTag)
    || !remoteBody.endsWith(closeScriptTag)) {
    throw new Error('远程文件不是有效的 Clash for UFI 插件包');
   }
   if (remoteVersion === PLUGIN_INFO.version) {
    createToast(`当前已是最新版本 v${PLUGIN_INFO.version}`, 'green');
    return;
   }
   const confirmed = await askConfirm(
    'ufi_proxy_studio_update_confirm',
    '发现插件更新',
    `当前版本：v${escapeHtml(PLUGIN_INFO.version)}<br>远程版本：v${escapeHtml(remoteVersion)}<br><br>更新只会替换“Clash for UFI”插件块，不影响其他插件。是否继续？`,
    '更新',
   );
   if (!confirmed) return;
   const customHead = await getCustomHead();
   const currentBlock = getPluginBlock(customHead);
   if (!currentBlock) throw new Error('当前 custom_head 中找不到 Clash for UFI 插件块');
   // Replace every historical copy of this plugin. A previous broken import
   // must not leave an older script behind to execute after the new one.
   const ownBlockPattern = /<!--\s*\[KANO_PLUGIN_START\]\s*Clash for UFI\s*-->[\s\S]*?<!--\s*\[KANO_PLUGIN_END\]\s*Clash for UFI\s*-->/g;
   const headWithoutOwnBlocks = customHead
    .replace(ownBlockPattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
   const updatedHead = `${headWithoutOwnBlocks}${headWithoutOwnBlocks ? '\n\n' : ''}${remoteBlock}`;
   localStorage.setItem('ufi_proxy_studio_previous_plugin_block', currentBlock);
   const result = await setCustomHead(updatedHead);
   if (!result || result.result !== 'success') throw new Error(result?.error || '写入插件设置失败');
   createToast(`已更新到 v${remoteVersion}，页面即将刷新`, 'green', 5000);
   setTimeout(() => location.reload(), 1800);
  } catch (error) {
   createToast(`检查更新失败：${String(error?.message || error)}`, 'red', 8000);
  }
 };

 const createProfileId = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `p_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
 };

 const normalizeProfileManifest = (value) => {
  const profiles = Array.isArray(value?.profiles)
   ? value.profiles.filter((profile) =>
    /^p_[0-9a-f]{16}$/.test(profile?.id)
    && ['yaml', 'subscription'].includes(profile?.type)
    && typeof profile?.name === 'string')
   : [];
  return {
   version: 1,
   activeId: profiles.some((profile) => profile.id === value?.activeId) ? value.activeId : null,
   profiles,
  };
 };

 const profileDataPath = (profile) => {
  if (!/^p_[0-9a-f]{16}$/.test(profile.id)) throw new Error('配置 ID 无效');
  return `${PROFILE_DIR}/${profile.id}.${profile.type === 'subscription' ? 'source' : 'yaml'}`;
 };

 const uploadFileToDevice = async (file, targetPath) => {
  if (!targetPath.startsWith(`${PROFILE_DIR}/`)) throw new Error('目标路径越界');
  const formData = new FormData();
  formData.append('file', file);
  const upload = await (
   await fetch(`${KANO_baseURL}/upload_img`, {
    method: 'POST',
    headers: common_headers,
    body: formData,
   })
  ).json();
  if (!upload.url) throw new Error(upload.error || '上传失败');
  const uploadedPath = `/data/data/com.minikano.f50_sms/files/${upload.url}`;
  const result = await runRootChecked(`
  candidate=${JSON.stringify(uploadedPath)}
  target=${JSON.stringify(targetPath)}
  test -f "$candidate"
  mkdir -p "${PROFILE_DIR}"
  chmod 700 "${PROFILE_DIR}"
  mv -f "$candidate" "$target"
  chmod 600 "$target"
  `, 30000);
  if (!result.success) throw new Error(result.content || '保存到设备失败');
 };

  const fixedDeviceFileHash = async (path) => {
   const result = await runRootChecked(`
   path=${JSON.stringify(path)}
   test -f "$path" || exit 10
   if command -v sha256sum >/dev/null 2>&1; then
     sha256sum "$path"
   elif command -v toybox >/dev/null 2>&1; then
     toybox sha256sum "$path"
   else
     exit 11
   fi
   `, 15000);
   const match = result.success && String(result.content || '').trim().match(/^([0-9a-f]{64})(?:\s|$)/i);
   if (!match) throw new Error('当前订阅指纹无法核验');
   return match[1].toLowerCase();
  };

  const persistCurrentSubscriptionSource = async (sourceText) => {
   const content = String(sourceText ?? '');
   if (!content.trim()) throw new Error('当前订阅链接为空');
   await uploadFileToDevice(new File([content], 'current-subscription.source', { type: 'text/plain' }), CURRENT_SUBSCRIPTION_SOURCE);
   const sourceHash = await fixedDeviceFileHash(CURRENT_SUBSCRIPTION_SOURCE);
   const activeHash = await fixedDeviceFileHash(ACTIVE_CONFIG_PATH);
   const marker = {
    version: 1,
    sourceHash,
    activeHash,
    updatedAt: new Date().toISOString(),
   };
   await uploadFileToDevice(new File([JSON.stringify(marker)], 'current-subscription.json', { type: 'application/json' }), CURRENT_SUBSCRIPTION_MARKER);
   let bound = false;
   const sourceCount = content.trim().split(/\s+/).filter(Boolean).length;
   let reasonCode = sourceCount === 1 ? '' : 'CURRENT_SOURCE_AMBIGUOUS';
   if (sourceCount === 1) {
    try {
     const result = await runSubscriptionBridge('bind');
     bound = result?.ok === true && result?.data?.bound === true;
     reasonCode = result?.data?.reasonCode || '';
    } catch (_) { reasonCode = 'REFRESH_SERVICE_UNAVAILABLE'; }
   }
   return { bound, sourceCount, reasonCode, sourceHash, activeHash };
  };

  const clearCurrentSubscriptionSource = async () => {
   const result = await runRootChecked(`rm -f ${JSON.stringify(CURRENT_SUBSCRIPTION_MARKER)} ${JSON.stringify(CURRENT_SUBSCRIPTION_SOURCE)}`, 15000);
   if (!result.success) throw new Error('当前订阅来源记录未能清除');
  };

  const localCurrentSubscriptionState = async () => {
   const result = await runRootChecked(`
   source=${JSON.stringify(CURRENT_SUBSCRIPTION_SOURCE)}
   marker=${JSON.stringify(CURRENT_SUBSCRIPTION_MARKER)}
   if [ ! -s "$source" ] || [ ! -s "$marker" ]; then echo MISSING; exit 0; fi
   count=$(awk 'NF { n += NF } END { print n + 0 }' "$source")
   case "$count" in
     1) echo RECORDED ;;
     0) echo MISSING ;;
     *) echo AMBIGUOUS ;;
   esac
   `, 10000);
   return result.success ? String(result.content || '').trim() : 'UNKNOWN';
  };

 const loadProfileManifest = async () => {
  const result = await runRootChecked(`
  mkdir -p "${PROFILE_DIR}"
  chmod 700 "${PROFILE_DIR}"
  if [ -f "${PROFILE_MANIFEST}" ]; then
    cat "${PROFILE_MANIFEST}"
  else
    echo '{"version":1,"activeId":null,"profiles":[]}'
  fi
  `);
  if (!result.success) throw new Error(result.content || '读取配置库失败');
  try {
   return normalizeProfileManifest(JSON.parse(result.content));
  } catch (_) {
   throw new Error('配置库清单损坏，请先备份 Profiles 目录');
  }
 };

 const saveProfileManifest = async (manifest) => {
  const normalized = normalizeProfileManifest(manifest);
  const tempPath = `${PROFILE_DIR}/manifest.json.tmp`;
  await uploadFileToDevice(
   new File([JSON.stringify(normalized, null, 2)], 'manifest.json', { type: 'application/json' }),
   tempPath,
  );
  const result = await runRootChecked(`
  test -s "${tempPath}"
  mv -f "${tempPath}" "${PROFILE_MANIFEST}"
  chmod 600 "${PROFILE_MANIFEST}"
  `);
  if (!result.success) throw new Error(result.content || '更新配置库清单失败');
  return normalized;
 };

 const readProfileData = async (profile) => {
  const path = profileDataPath(profile);
  const result = await runRootChecked(`
  test -f "${path}"
  cat "${path}"
  `, 15000);
  if (!result.success || !result.content) throw new Error(result.content || '配置文件不存在');
  return result.content;
 };

 const storeCurrentConfigProfile = async (name, manifest) => {
  const profile = {
   id: createProfileId(),
   name: name.trim(),
   type: 'yaml',
   createdAt: new Date().toISOString(),
   updatedAt: new Date().toISOString(),
  };
  const target = profileDataPath(profile);
  const result = await runRootChecked(`
  test -s /data/clash/Proxy/config.yaml
  mkdir -p "${PROFILE_DIR}"
  chmod 700 "${PROFILE_DIR}"
  cp -f /data/clash/Proxy/config.yaml "${target}"
  chmod 600 "${target}"
  `);
  if (!result.success) throw new Error(result.content || '保存当前配置失败');
  try {
   return await saveProfileManifest({ ...manifest, activeId: profile.id, profiles: [...manifest.profiles, profile] });
  } catch (error) {
   await runRootChecked(`rm -f "${target}"`);
   throw error;
  }
 };

 const storeUploadedYamlProfile = async (file, name, manifest) => {
  const profile = {
   id: createProfileId(),
   name: name.trim(),
   type: 'yaml',
   createdAt: new Date().toISOString(),
   updatedAt: new Date().toISOString(),
  };
  const target = profileDataPath(profile);
  await uploadFileToDevice(file, target);
  const validation = await runRootChecked(`
  cd /data/clash/Proxy
  if ! ./Clash.Core -t -d /data/clash/Proxy -f "${target}" > /data/clash/profile-test.log 2>&1; then
    cat /data/clash/profile-test.log
    exit 20
  fi
  `, 60000);
  if (!validation.success) {
   await runRootChecked(`rm -f "${target}"`);
   throw new Error(validation.content || 'YAML 校验失败');
  }
  try {
   return await saveProfileManifest({ ...manifest, profiles: [...manifest.profiles, profile] });
  } catch (error) {
   await runRootChecked(`rm -f "${target}"`);
   throw error;
  }
 };

 const storeSubscriptionProfile = async (name, urls, manifest) => {
  const validUrls = urls.map((url) => url.trim()).filter(Boolean);
  if (validUrls.length < 1 || validUrls.length > 3) throw new Error('订阅数量必须为 1 到 3 条');
  validUrls.forEach((url) => {
   const parsed = new URL(url);
   if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('订阅仅支持 HTTP/HTTPS 链接');
  });
  const source = validUrls.length === 1
   ? validUrls[0]
   : `${validUrls.join(' ')}\n${validUrls.map((_, index) => `provider${index + 1}`).join(' ')}`;
  const profile = {
   id: createProfileId(),
   name: name.trim(),
   type: 'subscription',
   createdAt: new Date().toISOString(),
   updatedAt: new Date().toISOString(),
  };
  const target = profileDataPath(profile);
  await uploadFileToDevice(new File([source], 'subscription.source', { type: 'text/plain' }), target);
  try {
   return await saveProfileManifest({ ...manifest, profiles: [...manifest.profiles, profile] });
  } catch (error) {
   await runRootChecked(`rm -f "${target}"`);
   throw error;
  }
 };

 const activateProfile = async (profile, manifest) => {
  const content = await readProfileData(profile);
  const file = new File([content], 'config.yaml', { type: 'text/plain' });
  const success = await saveConfig(file, { validate: profile.type === 'yaml' });
  if (!success) return null;
  const profiles = manifest.profiles.map((item) => item.id === profile.id
   ? { ...item, updatedAt: new Date().toISOString() }
   : item);
  const savedManifest = await saveProfileManifest({ ...manifest, activeId: profile.id, profiles });
   if (profile.type === 'subscription') await persistCurrentSubscriptionSource(content);
   else await clearCurrentSubscriptionSource();
  void updateSubscriptionRefreshButton();
  return savedManifest;
 };

 const deleteProfile = async (profile, manifest) => {
  const target = profileDataPath(profile);
  const result = await runRootChecked(`rm -f "${target}"`);
  if (!result.success) throw new Error(result.content || '删除配置失败');
  return saveProfileManifest({
   ...manifest,
   activeId: manifest.activeId === profile.id ? null : manifest.activeId,
   profiles: manifest.profiles.filter((item) => item.id !== profile.id),
  });
 };

 // ============================================================
 // 🆕 新增：通用代理链接解析器（支持 VLESS / Hysteria2）
 // ============================================================

 /**
  * 解析 VLESS Reality 链接
  */
 const parseVlessUrl = (url) => {
 try {
 const u = new URL(url);
 if (u.protocol !== 'vless:') throw '不是 VLESS 链接';

  const uuid = decodeURIComponent(u.username);
  const server = u.hostname;
  const port = u.port || '443';
  const name = decodeURIComponent(u.hash.replace('#', '')) || `VLESS_${server}`;
  const params = Object.fromEntries(u.searchParams.entries());

  if (!server) throw '缺少服务器地址';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
   throw 'UUID 格式无效';
  }
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
   throw '端口无效';
  }

 const proxy = {
 name,
 type: 'vless',
 server,
 port: parseInt(port),
 uuid,
 tls: params.security === 'reality' || params.security === 'tls',
 };

 if (params.sni) proxy.servername = params.sni;
 if (params.fp) proxy['client-fingerprint'] = params.fp;
 if (params.encryption) proxy.encryption = params.encryption;

 if (params.security === 'reality' && params.pbk) {
 proxy['reality-opts'] = {};
 proxy['reality-opts']['public-key'] = params.pbk;
 if (params.sid) proxy['reality-opts']['short-id'] = params.sid;
 }

 proxy.udp = true;
 if (!params.encryption || params.encryption === 'none') {
 proxy.encryption = '';
 }

 // 传输层
  const network = params.type || 'tcp';
  if (!['tcp', 'ws', 'grpc', 'http', 'httpupgrade'].includes(network)) {
   throw `暂不支持传输层: ${network}`;
  }
  proxy.network = network;

  if (network === 'ws') {
   proxy['ws-opts'] = { path: params.path || '/' };
   if (params.host) proxy['ws-opts'].headers = { Host: params.host };
  } else if (network === 'grpc') {
   proxy['grpc-opts'] = {
    'grpc-service-name': params.serviceName || params.service_name || '',
   };
   if (params.mode) proxy['grpc-opts']['grpc-mode'] = params.mode;
  } else if (network === 'http') {
   proxy['http-opts'] = {
    method: params.method || 'GET',
    path: [params.path || '/'],
   };
   if (params.host) proxy['http-opts'].headers = { Host: [params.host] };
  } else if (network === 'httpupgrade') {
   proxy['http-upgrade-opts'] = { path: params.path || '/' };
   if (params.host) proxy['http-upgrade-opts'].host = params.host;
  }

 // flow
 if (params.flow) proxy.flow = params.flow;

 return proxy;
 } catch (e) {
 throw `VLESS 解析失败: ${e}`;
 }
 };

 /**
  * 解析 Hysteria2 链接
  * hysteria2://password@server:port?insecure=1&sni=xxx&obfs=salamander&obfs-password=xxx&alpn=h3&up=100&down=1000#name
  */
 const parseHysteria2Url = (url) => {
 try {
 const u = new URL(url);
 if (u.protocol !== 'hysteria2:') throw '不是 Hysteria2 链接';

  const password = decodeURIComponent(u.username);
 const server = u.hostname;
 const port = u.port || '443';
 const name = decodeURIComponent(u.hash.replace('#', '')) || `Hysteria2_${server}`;
  const params = Object.fromEntries(u.searchParams.entries());

  if (!server) throw '缺少服务器地址';
  if (!password) throw '缺少 Hysteria2 密码';
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
   throw '端口无效';
  }

 const proxy = {
 name,
 type: 'hysteria2',
 server,
 port: parseInt(port),
 password,
 'skip-cert-verify': params.insecure === '1' || params.insecure === 'true',
 };

 if (params.sni) proxy.servername = params.sni;
 if (params.obfs && params.obfs !== 'none') {
 proxy.obfs = params.obfs;
 if (params['obfs-password']) proxy['obfs-password'] = params['obfs-password'];
 }
 if (params.alpn) {
 proxy.alpn = params.alpn.split(',').map(s => s.trim());
 }
  if (params.up && Number(params.up) > 0) proxy.up = Number(params.up);
  if (params.down && Number(params.down) > 0) proxy.down = Number(params.down);
  proxy.udp = true;

 return proxy;
 } catch (e) {
 throw `Hysteria2 解析失败: ${e}`;
 }
 };

 /**
  * 自动识别协议并解析
  */
 const parseProxyUrl = (url) => {
 const trimmed = url.trim();
 if (trimmed.startsWith('vless://')) {
 return parseVlessUrl(trimmed);
 } else if (trimmed.startsWith('hysteria2://')) {
 return parseHysteria2Url(trimmed);
 } else {
 throw '不支持的链接类型。目前支持: vless:// 和 hysteria2://';
 }
 };

 // 生成完整 mihomo 配置
 const generateMihomoConfig = (proxy, settings = loadPluginSettings()) => {
 const lines = [];
 const controllerSecret = getControllerSecret();

 // 不需要锚点，全部 inline
 lines.push('# 由 Clash for UFI 自动生成', '');

 lines.push('mixed-port: 7890');
 lines.push('allow-lan: true');
 lines.push('bind-address: "*"');
 lines.push('mode: rule');
 lines.push('log-level: info');
 lines.push('ipv6: true');
 lines.push('unified-delay: true');
 lines.push('tcp-concurrent: true', '');
 lines.push('geodata-mode: false');
 lines.push('geodata-loader: standard');
 lines.push('geo-auto-update: true');
 lines.push('geo-update-interval: 48');
 lines.push('geox-url:');
 lines.push(' geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"');
 lines.push(' mmdb: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.metadb"');
 lines.push(' geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat"', '');
 lines.push(`external-controller: 0.0.0.0:${settings.controllerPort}`);
 lines.push('external-ui: /data/clash/Proxy/WebUI/zashboard', '');
 lines.push(`secret: ${settings.controllerAuth ? yamlQuote(controllerSecret) : '""'}`, '');
 lines.push(`find-process-mode: ${settings.processMode}`, '');
 lines.push(`cmfa-plugin: {mode: ${settings.mode}}`, '');

 // profile
 lines.push('profile:');
 lines.push(' store-selected: true', '');

 // sniffer
 lines.push('sniffer:');
 lines.push(` enable: ${settings.sniffer}`);
 lines.push(' sniff:');
 lines.push(' HTTP:');
 lines.push(' ports: [80, 8080-8880]');
 lines.push(' override-destination: true');
 lines.push(' TLS:');
 lines.push(' ports: [443, 8443]');
 lines.push(' QUIC:');
 lines.push(' ports: [443, 8443]', '');

 // TUN 只在用户选择 TUN 模式时启用；TProxy 避免额外用户态网络栈开销。
 if (settings.mode === 'tun') {
 lines.push('tun:');
 lines.push(' enable: true');
 lines.push(` stack: ${settings.tunStack}`);
 lines.push(` mtu: ${settings.mtu}`);
 lines.push(' dns-hijack:');
 lines.push(' - "any:53"');
 lines.push(' - "tcp://any:53"');
 lines.push(' auto-route: true');
 lines.push(' auto-redirect: true');
 lines.push(' auto-detect-interface: true', '');
 }

 // DNS
 lines.push('dns:');
 lines.push(' enable: true');
 lines.push(' listen: 0.0.0.0:1053');
 lines.push(' ipv6: true');
 lines.push(' enhanced-mode: fake-ip');
 lines.push(` fake-ip-range: ${settings.fakeIpRange}`);
 lines.push(' fake-ip-filter-mode: blacklist');
 lines.push(' fake-ip-filter:');
 lines.push(' - "*.lan"');
 lines.push(' - "*.local"');
 lines.push(' - "localhost.ptlogin2.qq.com"');
 lines.push(' - "+.srv.nintendo.net"');
 lines.push(' - "+.stun.playstation.net"');
 lines.push(' - "xbox.*.microsoft.com"');
 lines.push(' - "*.xboxlive.com"');
 lines.push(' - "lms.*.v2ex.com"');
 lines.push(' default-nameserver:');
 lines.push(' - 119.29.29.29');
 lines.push(' - 223.5.5.5');
 lines.push(' nameserver:');
 lines.push(' - https://doh.pub/dns-query');
 lines.push(' - https://dns.alidns.com/dns-query#h3=true');
 lines.push(' fallback:');
 lines.push(' - https://dns.google/dns-query');
 lines.push(' - https://cloudflare-dns.com/dns-query');
 lines.push(' fallback-filter:');
 lines.push(' geoip: true');
 lines.push(' geoip-code: CN');
 lines.push(' geosite:');
 lines.push(' - gfw', '');

 // Proxies
 lines.push('proxies:');
 const yamlProxy = yamlifyProxy(proxy, ' ');
 yamlProxy.forEach(line => lines.push(line));
 lines.push('');

 // Proxy Groups
 lines.push('proxy-groups:');
 lines.push(' - name: "PROXY"');
 lines.push('   type: select');
 lines.push('   proxies:');
 lines.push(`   - ${yamlQuote(proxy.name)}`);
 lines.push('   - DIRECT');
 lines.push('   - REJECT', '');

 // Rules
 lines.push('rules:');
 // AI services
 lines.push(' - GEOSITE,openai,PROXY');
 // Google
 lines.push(' - GEOSITE,google,PROXY');
 lines.push(' - GEOSITE,youtube,PROXY');
 // Social
 lines.push(' - GEOSITE,telegram,PROXY');
 lines.push(' - GEOSITE,twitter,PROXY');
 lines.push(' - GEOSITE,facebook,PROXY');
 lines.push(' - GEOSITE,instagram,PROXY');
 lines.push(' - GEOSITE,discord,PROXY');
 // Dev
 lines.push(' - GEOSITE,github,PROXY');
 lines.push(' - GEOSITE,gitlab,PROXY');
 lines.push(' - DOMAIN-SUFFIX,stackoverflow.com,PROXY');
 // Microsoft
 lines.push(' - GEOSITE,microsoft,PROXY');
 lines.push(' - DOMAIN-SUFFIX,microsoft.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,office.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,office365.com,PROXY');
 // Media
 lines.push(' - GEOSITE,netflix,PROXY');
 lines.push(' - DOMAIN-SUFFIX,spotify.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,tiktok.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,tiktokv.com,PROXY');
 lines.push(' - GEOSITE,disney,PROXY');
 // Gaming
 lines.push(' - DOMAIN-SUFFIX,steampowered.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,steamcommunity.com,PROXY');
 lines.push(' - DOMAIN-SUFFIX,epicgames.com,PROXY');
 // GFW
 lines.push(' - GEOSITE,gfw,PROXY');
 lines.push(' - GEOSITE,geolocation-!cn,PROXY');
 // China direct
 lines.push(' - GEOSITE,cn,DIRECT');
 lines.push(' - GEOIP,CN,DIRECT');
 // Private
 lines.push(' - GEOIP,private,DIRECT,no-resolve');
 lines.push(' - MATCH,PROXY');
 lines.push('');

 return lines.join('\n');
 };

 /**
  * 将 proxy 对象序列化为 YAML 块（支持 VLESS / Hysteria2）
  */
 const yamlifyProxy = (proxy, indent = '') => {
 const lines = [];
 lines.push(`${indent}- name: ${yamlQuote(proxy.name)}`);
 lines.push(`${indent}  type: ${proxy.type}`);
 lines.push(`${indent}  server: ${yamlQuote(proxy.server)}`);
 lines.push(`${indent}  port: ${proxy.port}`);

 if (proxy.type === 'vless') {
 // --- VLESS Reality ---
 lines.push(`${indent}  uuid: ${yamlQuote(proxy.uuid)}`);
 lines.push(`${indent}  tls: ${proxy.tls}`);
 if (proxy.servername) lines.push(`${indent}  servername: ${yamlQuote(proxy.servername)}`);
 if (proxy['client-fingerprint']) lines.push(`${indent}  client-fingerprint: ${yamlQuote(proxy['client-fingerprint'])}`);
 if (proxy['reality-opts']) {
 lines.push(`${indent}  reality-opts:`);
 if (proxy['reality-opts']['public-key']) lines.push(`${indent}    public-key: ${yamlQuote(proxy['reality-opts']['public-key'])}`);
 if (proxy['reality-opts']['short-id']) lines.push(`${indent}    short-id: ${yamlQuote(proxy['reality-opts']['short-id'])}`);
 }
 if (proxy.flow) lines.push(`${indent}  flow: ${yamlQuote(proxy.flow)}`);
 lines.push(`${indent}  udp: true`);
 if (proxy.encryption !== undefined) lines.push(`${indent}  encryption: ${yamlQuote(proxy.encryption)}`);
 lines.push(`${indent}  network: ${proxy.network}`);

 if (proxy['ws-opts']) {
  lines.push(`${indent}  ws-opts:`);
  lines.push(`${indent}    path: ${yamlQuote(proxy['ws-opts'].path)}`);
  if (proxy['ws-opts'].headers?.Host) {
   lines.push(`${indent}    headers:`);
   lines.push(`${indent}      Host: ${yamlQuote(proxy['ws-opts'].headers.Host)}`);
  }
 }
 if (proxy['grpc-opts']) {
  lines.push(`${indent}  grpc-opts:`);
  lines.push(`${indent}    grpc-service-name: ${yamlQuote(proxy['grpc-opts']['grpc-service-name'])}`);
  if (proxy['grpc-opts']['grpc-mode']) {
   lines.push(`${indent}    grpc-mode: ${yamlQuote(proxy['grpc-opts']['grpc-mode'])}`);
  }
 }
  if (proxy['http-upgrade-opts']) {
  lines.push(`${indent}  http-upgrade-opts:`);
  lines.push(`${indent}    path: ${yamlQuote(proxy['http-upgrade-opts'].path)}`);
  if (proxy['http-upgrade-opts'].host) {
   lines.push(`${indent}    host: ${yamlQuote(proxy['http-upgrade-opts'].host)}`);
  }
  }
  if (proxy['http-opts']) {
   lines.push(`${indent}  http-opts:`);
   lines.push(`${indent}    method: ${yamlQuote(proxy['http-opts'].method)}`);
   lines.push(`${indent}    path:`);
   proxy['http-opts'].path.forEach((path) => lines.push(`${indent}      - ${yamlQuote(path)}`));
   if (proxy['http-opts'].headers?.Host?.length) {
    lines.push(`${indent}    headers:`);
    lines.push(`${indent}      Host:`);
    proxy['http-opts'].headers.Host.forEach((host) => lines.push(`${indent}        - ${yamlQuote(host)}`));
   }
  }

 } else if (proxy.type === 'hysteria2') {
 // --- Hysteria2 ---
 lines.push(`${indent}  password: ${yamlQuote(proxy.password)}`);
 lines.push(`${indent}  skip-cert-verify: ${proxy['skip-cert-verify']}`);
 if (proxy.servername) lines.push(`${indent}  sni: ${yamlQuote(proxy.servername)}`);
 if (proxy.obfs) {
 lines.push(`${indent}  obfs: ${yamlQuote(proxy.obfs)}`);
 if (proxy['obfs-password']) lines.push(`${indent}  obfs-password: ${yamlQuote(proxy['obfs-password'])}`);
 }
 if (proxy.alpn && proxy.alpn.length > 0) {
 lines.push(`${indent}  alpn:`);
 proxy.alpn.forEach(a => lines.push(`${indent}    - ${yamlQuote(a)}`));
 }
 if (proxy.up) lines.push(`${indent}  up: ${proxy.up}`);
 if (proxy.down) lines.push(`${indent}  down: ${proxy.down}`);
 lines.push(`${indent}  udp: true`);
 }

  return lines;
  };

 const parseYamlScalar = (value) => {
  const trimmed = String(value ?? '').trim().replace(/\s+#.*$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
   try { return JSON.parse(trimmed); } catch (_) { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
   return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
 };

 const findTopLevelValue = (yamlText, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(yamlText).match(new RegExp(`^${escaped}:\\s*(.*?)\\s*$`, 'm'));
  return match ? parseYamlScalar(match[1]) : undefined;
 };

 const findNestedValue = (yamlText, parent, key) => {
  const lines = String(yamlText).replace(/\r\n/g, '\n').split('\n');
  const parentPattern = new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*?)\\s*$`);
  const childPattern = new RegExp(`^\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*?)\\s*$`);
  const parentIndex = lines.findIndex((line) => parentPattern.test(line));
  if (parentIndex < 0) return undefined;
  const parentTail = lines[parentIndex].match(parentPattern)?.[1] || '';
  if (parentTail.startsWith('{')) {
   const inlineMatch = parentTail.match(new RegExp(`(?:^|[,\\s{])${key}:\\s*([^,}]+)`));
   return inlineMatch ? parseYamlScalar(inlineMatch[1]) : undefined;
  }
  for (let i = parentIndex + 1; i < lines.length; i += 1) {
   if (/^[^\s#][^:]*:/.test(lines[i])) break;
   const childMatch = lines[i].match(childPattern);
   if (childMatch) return parseYamlScalar(childMatch[1]);
  }
  return undefined;
 };

 const readSettingsFromConfig = (yamlText, fallback = loadPluginSettings()) => {
  const cmfaMode = findNestedValue(yamlText, 'cmfa-plugin', 'mode');
  const tunEnabled = findNestedValue(yamlText, 'tun', 'enable');
  const controller = String(findTopLevelValue(yamlText, 'external-controller') || '0.0.0.0:7788');
  const portMatch = controller.match(/:(\d+)$/);
  const secret = String(findTopLevelValue(yamlText, 'secret') || '');
  return {
   ...fallback,
   mode: cmfaMode === 'tun' || tunEnabled === true ? 'tun' : 'tproxy',
   tunStack: String(findNestedValue(yamlText, 'tun', 'stack') || fallback.tunStack),
   mtu: Number(findNestedValue(yamlText, 'tun', 'mtu')) || fallback.mtu,
   fakeIpRange: String(findNestedValue(yamlText, 'dns', 'fake-ip-range') || fallback.fakeIpRange),
   controllerPort: Number(portMatch?.[1]) || fallback.controllerPort,
   controllerAuth: secret.length > 0,
   controllerSecret: secret,
   processMode: String(findTopLevelValue(yamlText, 'find-process-mode') || fallback.processMode),
   sniffer: findNestedValue(yamlText, 'sniffer', 'enable') !== false,
  };
 };

 const setTopLevelValue = (yamlText, key, value) => {
  const lines = String(yamlText).replace(/\r\n/g, '\n').split('\n');
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
  const index = lines.findIndex((line) => pattern.test(line));
  const replacement = `${key}: ${value}`;
  if (index >= 0) lines[index] = replacement;
  else lines.push(replacement);
  return lines.join('\n');
 };

 const setNestedValue = (yamlText, parent, key, value) => {
  const lines = String(yamlText).replace(/\r\n/g, '\n').split('\n');
  const parentPattern = new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*?)\\s*$`);
  let parentIndex = lines.findIndex((line) => parentPattern.test(line));
  if (parentIndex < 0) {
   lines.push(`${parent}:`, `  ${key}: ${value}`);
   return lines.join('\n');
  }
  const parentTail = lines[parentIndex].match(parentPattern)?.[1] || '';
  if (parentTail.startsWith('{')) {
   const inlineKey = new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)([^,}]+)`);
   if (inlineKey.test(parentTail)) {
    lines[parentIndex] = `${parent}: ${parentTail.replace(inlineKey, `$1${value}`)}`;
   } else {
    lines[parentIndex] = `${parent}: ${parentTail.replace(/}\s*$/, `, ${key}: ${value}}`)}`;
   }
   return lines.join('\n');
  }
  const childPattern = new RegExp(`^(\\s+)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
  let endIndex = lines.length;
  for (let i = parentIndex + 1; i < lines.length; i += 1) {
   if (/^[^\s#][^:]*:/.test(lines[i])) { endIndex = i; break; }
   if (childPattern.test(lines[i])) {
    const indent = lines[i].match(childPattern)?.[1] || '  ';
    lines[i] = `${indent}${key}: ${value}`;
    return lines.join('\n');
   }
  }
  lines.splice(endIndex, 0, `  ${key}: ${value}`);
  return lines.join('\n');
 };

 const applySettingsToConfig = (yamlText, settings) => {
  let output = String(yamlText).replace(/\r\n/g, '\n');
  const currentController = String(findTopLevelValue(output, 'external-controller') || '0.0.0.0:7788');
  const controllerHost = currentController.replace(/:\d+$/, '') || '0.0.0.0';
  const currentSecret = String(findTopLevelValue(output, 'secret') || '');
  const secret = settings.controllerAuth ? (currentSecret || getControllerSecret()) : '';
  output = setNestedValue(output, 'cmfa-plugin', 'mode', settings.mode);
  output = setNestedValue(output, 'dns', 'fake-ip-range', yamlQuote(settings.fakeIpRange));
  output = setNestedValue(output, 'sniffer', 'enable', String(settings.sniffer));
  output = setTopLevelValue(output, 'external-controller', `${controllerHost}:${settings.controllerPort}`);
  output = setTopLevelValue(output, 'secret', yamlQuote(secret));
  output = setTopLevelValue(output, 'find-process-mode', settings.processMode);
  if (settings.mode === 'tun') {
   output = setNestedValue(output, 'tun', 'enable', 'true');
   output = setNestedValue(output, 'tun', 'stack', settings.tunStack);
   output = setNestedValue(output, 'tun', 'mtu', String(settings.mtu));
  } else if (findTopLevelValue(output, 'tun') !== undefined || /^tun:\s*$/m.test(output)) {
   output = setNestedValue(output, 'tun', 'enable', 'false');
  }
  return output;
 };

 // ============================================================
 // Clash for UFI：可视化参数设置
 // ============================================================
 const showPluginSettingsDialog = async () => {
  const localSettings = loadPluginSettings();
  let settings = localSettings;
  let currentConfigText = '';
  let configLoaded = false;
  if (await checkIsInstalled()) {
   const configRes = await runRootChecked(`
   test -f /data/clash/Proxy/config.yaml
   cat /data/clash/Proxy/config.yaml
   `, 10000);
   if (configRes.success && configRes.content) {
    currentConfigText = configRes.content;
    settings = readSettingsFromConfig(currentConfigText, localSettings);
    configLoaded = true;
   }
  }
  const activeSecret = settings.controllerSecret || getControllerSecret();
   const { el, close } = createPluginToast(
   'ufi_proxy_studio_settings',
   `<div id="ufi_proxy_studio_panel" style="${panelStyle(settings)}">
    <div class="title" style="margin:0 0 12px">⚙️ Clash for UFI 参数中心</div>
    <div style="display:grid;grid-template-columns:minmax(120px,.8fr) minmax(180px,1.2fr);gap:10px;align-items:center;font-size:.68rem">
     <label>代理模式</label>
     <select id="ej_mode"><option value="tproxy">TProxy（热点性能优先）</option><option value="tun">TUN（包含本机流量）</option></select>
     <label>TUN 网络栈</label>
     <select id="ej_stack"><option value="mixed">mixed（推荐）</option><option value="system">system</option><option value="gvisor">gVisor（兼容优先）</option></select>
     <label>MTU</label><input id="ej_mtu" type="number" min="1280" max="9000" step="10">
     <label>Fake-IP 网段</label><input id="ej_fake_ip" type="text">
     <label>控制端口</label><input id="ej_controller_port" type="number" min="1024" max="65535">
     <label>控制器鉴权</label><label><input id="ej_controller_auth" type="checkbox"> 使用密钥保护前端/API</label>
     <label>进程匹配</label>
     <select id="ej_process"><option value="off">off（推荐）</option><option value="strict">strict</option><option value="always">always</option></select>
     <label>流量嗅探</label><label><input id="ej_sniffer" type="checkbox"> 启用 HTTP/TLS/QUIC 嗅探</label>
     <label>面板不透明度</label>
     <div style="display:flex;gap:8px;align-items:center"><input id="ej_opacity" type="range" min="0.25" max="1" step="0.01" style="flex:1"><span id="ej_opacity_value"></span></div>
    </div>
    <div style="margin-top:12px;padding:9px;border-radius:8px;background:rgba(0,0,0,.25);font-size:.58rem;word-break:break-all">
     Mihomo 控制密钥：<code id="ej_secret">${settings.controllerAuth ? '••••••••（已启用）' : '未启用'}</code>
     <button id="ej_copy_secret" style="margin-left:6px">复制</button>
    </div>
    <div id="ej_config_status" style="margin-top:10px;font-size:.58rem;opacity:.84">${configLoaded ? '✅ 已从设备当前 config.yaml 读取。应用时会保留节点、策略组、规则和 rule-provider。' : '⚠️ 未读取到设备配置；当前显示本地默认值，只能保存界面设置。'}</div>
    <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
     <button id="ej_reload">重新读取</button><button id="ej_save_ui">仅保存界面</button><button id="ej_apply" ${configLoaded ? '' : 'disabled'}>应用到当前配置</button><button id="ej_close">关闭</button>
    </div>
   </div>`,
  );
  const $ = (selector) => el.querySelector(selector);
  $('#ej_mode').value = settings.mode;
  $('#ej_stack').value = settings.tunStack;
  $('#ej_mtu').value = settings.mtu;
  $('#ej_fake_ip').value = settings.fakeIpRange;
  $('#ej_controller_port').value = settings.controllerPort;
  $('#ej_controller_auth').checked = settings.controllerAuth;
  $('#ej_process').value = settings.processMode;
  $('#ej_sniffer').checked = settings.sniffer;
  $('#ej_opacity').value = settings.panelOpacity;
  $('#ej_opacity_value').textContent = `${Math.round(settings.panelOpacity * 100)}%`;

  const toggleTunFields = () => {
   const enabled = $('#ej_mode').value === 'tun';
   $('#ej_stack').disabled = !enabled;
   $('#ej_mtu').disabled = !enabled;
  };
  toggleTunFields();
  $('#ej_mode').onchange = toggleTunFields;
  $('#ej_opacity').oninput = (event) => {
   const value = Number(event.target.value);
   $('#ej_opacity_value').textContent = `${Math.round(value * 100)}%`;
   el.style.backgroundColor = `rgba(13,17,23,${value})`;
  };
  $('#ej_copy_secret').onclick = async () => {
   await navigator.clipboard.writeText(activeSecret);
   createToast('控制密钥已复制', 'green');
  };
  const collectSettings = () => ({
     mode: $('#ej_mode').value,
     tunStack: $('#ej_stack').value,
     mtu: Number($('#ej_mtu').value),
    fakeIpRange: $('#ej_fake_ip').value.trim(),
    controllerPort: Number($('#ej_controller_port').value),
    controllerAuth: $('#ej_controller_auth').checked,
     processMode: $('#ej_process').value,
     sniffer: $('#ej_sniffer').checked,
     panelOpacity: Number($('#ej_opacity').value),
    });
  $('#ej_reload').onclick = () => {
   close();
   setTimeout(() => showPluginSettingsDialog(), 350);
  };
  $('#ej_save_ui').onclick = () => {
   const next = collectSettings();
   savePluginSettings(next);
   close();
   createToast('界面偏好已保存；未修改当前代理配置', 'green');
  };
  $('#ej_apply').onclick = async () => {
   const next = collectSettings();
   if (!configLoaded || !currentConfigText) {
    createToast('未读取到当前配置，无法应用', 'red');
    return;
   }
   const confirmed = await askConfirm(
    'ufi_proxy_studio_apply_settings',
    '应用代理参数',
    '将修改当前 config.yaml 中的运行参数，并保留节点、策略组和规则。应用前会自动校验与备份，是否继续？',
   );
   if (!confirmed) return;
   savePluginSettings(next);
   const patchedConfig = applySettingsToConfig(currentConfigText, next);
   const file = new File([patchedConfig], 'config.yaml', { type: 'text/yaml' });
   if (await saveConfig(file)) close();
  };
 $('#ej_close').onclick = close;
 };

 const showAddSubscriptionProfileDialog = (onSave) => {
  const settings = loadPluginSettings();
  const { el, close } = createPluginToast(
   'ufi_proxy_studio_add_subscription',
   `<div style="${panelStyle(settings)}max-width:620px">
    <div class="title" style="margin:0 0 12px">🔗 保存服务商订阅</div>
    <div style="display:flex;flex-direction:column;gap:9px">
     <input id="ups_sub_name" type="text" maxlength="40" placeholder="配置名称，例如：流量服务商">
     <input id="ups_sub_url1" type="password" placeholder="订阅链接 1">
     <input id="ups_sub_url2" type="password" placeholder="订阅链接 2（可选）">
     <input id="ups_sub_url3" type="password" placeholder="订阅链接 3（可选）">
    </div>
    <div style="margin-top:10px;font-size:.58rem;opacity:.8">链接将以 600 权限保存在设备本地，不写入 Git。每次“更新并切换”都会重新交给 clashctl 转换。</div>
    <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:8px">
     <button id="ups_sub_save">保存到配置库</button><button id="ups_sub_close">关闭</button>
    </div>
   </div>`,
  );
  el.querySelector('#ups_sub_close').onclick = close;
  el.querySelector('#ups_sub_save').onclick = async () => {
   const name = el.querySelector('#ups_sub_name').value.trim();
   const urls = [1, 2, 3].map((index) => el.querySelector(`#ups_sub_url${index}`).value.trim());
   if (!name) return createToast('请输入配置名称', 'red');
   if (!urls[0]) return createToast('请至少输入一条订阅链接', 'red');
   const button = el.querySelector('#ups_sub_save');
   button.disabled = true;
   try {
    await onSave(name, urls);
    close();
   } catch (error) {
    createToast(`保存订阅失败：${String(error?.message || error)}`, 'red', 8000);
   } finally {
    button.disabled = false;
   }
  };
 };

 const showProfileManagerDialog = async () => {
  if (!(await checkAdvanceFunc())) return createToast('没有开启高级功能，无法使用配置库', 'red');
 if (!(await checkIsInstalled())) return createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
  let manifest;
  try {
   manifest = await loadProfileManifest();
  } catch (error) {
   createToast(`读取配置库失败：${String(error?.message || error)}`, 'red', 8000);
   return;
  }
  const settings = loadPluginSettings();
  const { el, close } = createPluginToast(
   'ufi_proxy_studio_profiles',
   `<div style="${panelStyle(settings)}max-width:760px">
    <div class="title" style="margin:0 0 12px">🗂️ 配置库</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
     <input id="ups_profile_name" type="text" maxlength="40" placeholder="配置名称" style="flex:1;min-width:180px">
     <button id="ups_save_current">保存当前配置</button>
     <button id="ups_import_yaml">导入 YAML 到库</button>
     <button id="ups_add_subscription">保存订阅</button>
     <input id="ups_yaml_file" type="file" accept=".yaml,.yml,text/yaml,text/plain" style="display:none">
    </div>
    <div style="margin-top:10px;font-size:.58rem;opacity:.8">配置保存在设备 ${PROFILE_DIR}。切换会覆盖当前 config.yaml，但会先校验、备份，并在启动失败时回滚。</div>
    <div id="ups_profile_list" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;max-height:48vh;overflow:auto"></div>
    <div style="margin-top:14px;text-align:right"><button id="ups_profiles_close">关闭</button></div>
   </div>`,
  );
  const list = el.querySelector('#ups_profile_list');
  const refresh = () => {
   close();
   setTimeout(() => showProfileManagerDialog(), 350);
  };
  const renderProfiles = () => {
   if (!manifest.profiles.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;opacity:.65">配置库为空。可以保存当前配置、导入 YAML 或保存订阅。</div>';
    return;
   }
   list.innerHTML = [...manifest.profiles].reverse().map((profile) => {
    const active = manifest.activeId === profile.id;
    const typeLabel = profile.type === 'subscription' ? '订阅' : 'YAML';
    const actionLabel = profile.type === 'subscription' ? '更新并切换' : '切换';
    const updated = profile.updatedAt ? new Date(profile.updatedAt).toLocaleString() : '';
    return `<div style="padding:10px;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:rgba(0,0,0,.2);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
     <div style="flex:1;min-width:190px"><div>${active ? '🟢 ' : ''}<strong>${escapeHtml(profile.name)}</strong> <span style="opacity:.6">[${typeLabel}]</span></div><div style="font-size:.52rem;opacity:.55;margin-top:3px">${escapeHtml(updated)}</div></div>
     <button class="ups_profile_activate" data-id="${profile.id}">${actionLabel}</button>
     <button class="ups_profile_delete" data-id="${profile.id}">删除</button>
    </div>`;
   }).join('');
   list.querySelectorAll('.ups_profile_activate').forEach((button) => {
    button.onclick = async () => {
     const profile = manifest.profiles.find((item) => item.id === button.dataset.id);
     if (!profile) return;
     const confirmed = await askConfirm(
      `ufi_profile_activate_${profile.id}`,
      profile.type === 'subscription' ? '更新并切换订阅' : '切换配置',
      `即将应用“${escapeHtml(profile.name)}”。当前配置会自动备份，是否继续？`,
     );
     if (!confirmed) return;
     button.disabled = true;
     try {
      const updatedManifest = await activateProfile(profile, manifest);
      if (updatedManifest) {
       manifest = updatedManifest;
       createToast(`已切换到：${escapeHtml(profile.name)}`, 'green');
       refresh();
      }
     } catch (error) {
      createToast(`切换失败：${String(error?.message || error)}`, 'red', 8000);
     } finally {
      button.disabled = false;
     }
    };
   });
   list.querySelectorAll('.ups_profile_delete').forEach((button) => {
    button.onclick = async () => {
     const profile = manifest.profiles.find((item) => item.id === button.dataset.id);
     if (!profile) return;
     const confirmed = await askConfirm(
      `ufi_profile_delete_${profile.id}`,
      '删除配置',
      `将从设备删除“${escapeHtml(profile.name)}”的库存文件。当前正在运行的配置不会被删除，是否继续？`,
      '删除',
     );
     if (!confirmed) return;
     button.disabled = true;
     try {
      manifest = await deleteProfile(profile, manifest);
      createToast('配置已从库中删除', 'green');
      refresh();
     } catch (error) {
      createToast(`删除失败：${String(error?.message || error)}`, 'red', 8000);
     } finally {
      button.disabled = false;
     }
    };
   });
  };
  renderProfiles();
  el.querySelector('#ups_profiles_close').onclick = close;
  el.querySelector('#ups_save_current').onclick = async () => {
   const name = el.querySelector('#ups_profile_name').value.trim();
   if (!name) return createToast('请先填写配置名称', 'red');
   const button = el.querySelector('#ups_save_current');
   button.disabled = true;
   try {
    manifest = await storeCurrentConfigProfile(name, manifest);
    createToast('当前配置已保存到配置库', 'green');
    refresh();
   } catch (error) {
    createToast(`保存失败：${String(error?.message || error)}`, 'red', 8000);
   } finally {
    button.disabled = false;
   }
  };
  const fileInput = el.querySelector('#ups_yaml_file');
  el.querySelector('#ups_import_yaml').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
   const file = fileInput.files?.[0];
   if (!file) return;
   if (file.size > 1024 * 1024) {
    fileInput.value = '';
    return createToast('配置文件不能超过 1MB', 'red');
   }
   const fallbackName = file.name.replace(/\.(yaml|yml)$/i, '');
   const name = el.querySelector('#ups_profile_name').value.trim() || fallbackName;
   try {
    manifest = await storeUploadedYamlProfile(file, name, manifest);
    createToast('YAML 已校验并保存到配置库', 'green');
    refresh();
   } catch (error) {
    createToast(`导入失败：${String(error?.message || error)}`, 'red', 8000);
   } finally {
    fileInput.value = '';
   }
  };
  el.querySelector('#ups_add_subscription').onclick = () => {
   showAddSubscriptionProfileDialog(async (name, urls) => {
    manifest = await storeSubscriptionProfile(name, urls, manifest);
    createToast('订阅已保存到配置库', 'green');
    refresh();
   });
  };
 };

 // ============================================================
 // 🆕 新增按钮：自建节点
 // ============================================================
 const showNodeInputDialog = () => {
 const settings = loadPluginSettings();
 const { el, close } = createPluginToast(
  'mm_self_node_toast',
  `<div style="${panelStyle(settings)}">
  <div class="title" style="margin:0">🔗 添加自建节点</div>
  <div style="margin:12px 0 8px;font-size:.7rem;opacity:.8">粘贴 VLESS / Hysteria2 链接，自动生成配置 · 当前模式：${settings.mode.toUpperCase()}</div>
 <input id="mm_node_url_input" type="text" placeholder="vless://... 或 hysteria2://..." style="width:100%;padding:10px;border:1px solid #555;border-radius:4px;outline:none;background:#000;color:#0f0;font-size:.7rem;box-sizing:border-box;">
 <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
 <button id="mm_node_gen_btn" style="font-size:.64rem">✅ 生成并启动</button>
 <button id="mm_node_preview_btn" style="font-size:.64rem">👁 预览配置</button>
 <button id="mm_node_close_btn" style="font-size:.64rem">✕ 关闭</button>
 </div>
 <pre id="mm_node_preview_box" style="display:none;margin-top:10px;background:#111;color:#0f0;padding:8px;border-radius:4px;max-height:300px;overflow:auto;font-size:.55rem;line-height:1.3;white-space:pre-wrap;"></pre>
 </div>`,
 );

 const input = el.querySelector('#mm_node_url_input');
 const genBtn = el.querySelector('#mm_node_gen_btn');
 const previewBtn = el.querySelector('#mm_node_preview_btn');
 const previewBox = el.querySelector('#mm_node_preview_box');
 const closeBtn = el.querySelector('#mm_node_close_btn');

 closeBtn.onclick = close;

 genBtn.onclick = async () => {
 const url = input.value.trim();
 if (!url) {
 createToast('请粘贴节点链接！', 'red');
 return;
 }
 try {
 const proxy = parseProxyUrl(url);
 const config = generateMihomoConfig(proxy);
 createToast('配置生成成功，正在写入...', 'green');
 const file = new File([config], 'config.yaml', { type: 'text/plain' });
 const ok = await saveConfig(file);
 if (ok) {
 close();
 }
 } catch (e) {
 createToast(String(e), 'red');
 }
 };

 previewBtn.onclick = () => {
 const url = input.value.trim();
 if (!url) {
 createToast('请先粘贴节点链接！', 'red');
 return;
 }
 try {
 const proxy = parseProxyUrl(url);
 const config = generateMihomoConfig(proxy);
 previewBox.textContent = config;
 previewBox.style.display = 'block';
 } catch (e) {
 createToast(String(e), 'red');
 }
 };

 // 回车提交
 input.addEventListener('keydown', (e) => {
 if (e.key === 'Enter') genBtn.click();
 });
 };

 // ============================================================
 // 以下为原版 猫猫 TProxy 1.2 功能 —— 无修改
 // ============================================================

 const showDialog = (message, title = '提示') => {
 let timer = null;
 const containerId = 'toast_' + createRandomString(4);
 const id = 'close_message_btn_' + createRandomString(4);
 const id_download = 'download_btn_' + createRandomString(4);
 const id_clear = 'clear_btn_' + createRandomString(4);
 const id_refresh = 'clear_btn_' + createRandomString(4);
 const id_pause = 'pause_btn_' + createRandomString(4);
 const message1 = message.replaceAll('\n', '<br>');
 const { el, close } = createPluginToast(
 containerId,
 `
 <div style="pointer-events:all;width:80vw;max-width:800px">
 <div class="title" style="margin:0" data-i18n="system_notice">${title}</div>
 <div class="content_message" style="background: rgba(0, 0, 0, 0.8);color: rgb(0, 255, 0);box-sizing: border-box;font-family: sans-serif;line-height:1.4;margin:10px 0;max-height: 400px;overflow: auto;font-size: .64rem;">${message1}</div>
 <div style="text-align:right">
 <button style="font-size:.64rem" id="${id}" data-i18n="close_btn">${t('close_btn')}</button>
 <button style="font-size:.64rem" id="${id_download}" data-i18n="only_download">${t('only_download')}</button>
 <button style="font-size:.64rem;background:var(--dark-btn-color-active)" id="${id_pause}">自动滚动</button>
 <button style="font-size:.64rem" id="${id_refresh}">刷新</button>
 <button style="font-size:.64rem" id="${id_clear}">清空日志</button>
 </div>
 </div>
 `,
 );
 const btn = el.querySelector(`#${id}`);
 const download = el.querySelector(`#${id_download}`);
 const clearBtn = el.querySelector(`#${id_clear}`);
 const rBtn = el.querySelector(`#${id_refresh}`);
 const msg_el = el.querySelector(`.content_message`);

 if (!btn) {
 close();
 if (timer) timer();
 return;
 }

 let shouldPause = false;
 let fnfn = requestInterval(() => {
 if (msg_el && !shouldPause) {
 msg_el.scrollTo({
 top: msg_el.scrollHeight + 199,
 left: 0,
 behavior: 'smooth',
 });
 }
 }, 500);

 if (download) {
 download.onclick = async () => {
 const t = Math.floor(Date.now() + Math.random());
 const file = new File([message1.replaceAll('<br>', '\n')], {
 type: 'text/plain',
 });
 const url = URL.createObjectURL(file);
 const a = document.createElement('a');
 a.download = `kano_mm_log_${t}.txt`;
 a.href = url;
 document.body.appendChild(a);
 a.click();
 URL.revokeObjectURL(url);
 a.remove();
 };
 }

 if (clearBtn) {
 clearBtn.onclick = async () => {
 const res = await runShellWithRoot(
 `echo "" > /sdcard/Clash内核日志.txt`,
 );
 if (res.success) {
 createToast('日志已清空', 'green');
 close();
 if (timer) timer();
 fnfn && fnfn();
 } else {
 createToast(`清空日志失败`, 'red');
 }
 };
 }

 const refresh = async (flag = false) => {
 const msg_el = el.querySelector(`.content_message`);
 const res = await runShellWithRoot(
 `timeout 2s awk \'{print}\' /sdcard/Clash内核日志.txt | tail -n 100`,
 );
 if (res.success) {
 msg_el.innerHTML = res.content.replaceAll('\n', '<br>');
 flag && createToast('日志已刷新');
 } else {
 flag && createToast('获取日志失败', 'red');
 }
 };

 if (rBtn) {
 rBtn.onclick = async () => {
 await refresh(true);
 };
 }

 if (timer) timer();
 timer = requestInterval(async () => {
 await refresh();
 }, 1000);

 btn.onclick = async () => {
 if (timer) timer();
 close();
 fnfn && fnfn();
 };

 const pause_btn = el.querySelector(`#${id_pause}`);
 if (pause_btn) {
 pause_btn.dataset.paused = '1';
 pause_btn.onclick = () => {
 if (pause_btn.dataset.paused != '1') {
 pause_btn.dataset.paused = '1';
 pause_btn.style.background = 'var(--dark-btn-color-active)';
 shouldPause = false;
 } else {
 pause_btn.dataset.paused = '0';
 pause_btn.style.background = '';
 shouldPause = true;
 }
 };
 }
 };

 const btn_enabled = document.createElement('button');
 btn_enabled.textContent = '安装';
 let disabled_btn_enabled = false;
 btn_enabled.onclick = async (e) => {
 if (disabled_btn_enabled) return;
 disabled_btn_enabled = true;
 try {
 if (!(await checkAdvanceFunc())) {
 disabled_btn_enabled = false;
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (await checkIsInstalled()) {
 disabled_btn_enabled = false;
 createToast('已检测到 Mihomo 核心！', 'red');
 return;
 }

 createToast('下载所需组件中...');
 const res0 = await runShellWithRoot(
 `/data/data/com.minikano.f50_sms/files/curl -L "https://pan.kanokano.cn/d/UFI-TOOLS-UPDATE/plugins/mihomo-tproxy.zip" -o /data/kano_clash.zip --output /data/kano_clash.zip --write-out "DOWNLOAD_DONE\nTotal: %{size_download} bytes\nSpeed: %{speed_download} B/s\nTime: %{time_total} sec\n" > /data/kano_mihomo_latest.dlog 2>&1 &`,
 100 * 1000,
 );
 if (!res0.success) {
 btn_enabled.disabled = false;
 return createToast('下载依赖失败!', 'red');
 }

 let log = '';
 const max_times = 600;
 let count_times = 0;
 const { el, close } = createPluginToast(
 'kano_mihomo_toast',
 `<pre style="white-space: pre-wrap;min-width:300px;text-align: center;">等待日志中...</pre>`,
 '',
 );

 const interval = setInterval(async () => {
 const dlog = await runShellWithRoot(
 "timeout 2s awk '{print}' /data/kano_mihomo_latest.dlog",
 );
 const lines = dlog.content.split('\n');
 log = lines.slice(-6).join('\n');
 el.innerHTML = `<pre style="white-space: pre-wrap;min-width:300px;text-align: center;">${log.replaceAll('\n', '<br>')}</pre>`;
 if (log.includes('DOWNLOAD_DONE')) {
 setTimeout(() => {
 close();
 }, 2000);
 }
 }, 1000);

 while (true) {
 if (max_times <= count_times) {
 clearInterval(interval);
 btn_enabled.disabled = false;
 return ('下载超时，请检查网络连接或稍后重试！', 'red');
 }
 if (log.includes('DOWNLOAD_DONE')) {
 clearInterval(interval);
 break;
 }
 count_times++;
 await new Promise((resolve) => setTimeout(resolve, 1000));
 }

 await runShellWithRoot('rm -f /data/kano_mihomo_latest.dlog');

 createToast('解压 Mihomo 核心文件...');
 const res2 = await runShellWithRoot(`
 cd /data/
 mkdir -p clash
 unzip kano_clash.zip -d /data/clash/
 `);
 if (!res2.success) return createToast('解压 Mihomo 核心文件出错！', 'red');

 createToast('检查依赖文件，可能需要一点时间...');
 const res3 = await runShellWithRoot(`
 ls /data/clash/Scripts
 `);
 if (!res3.success || !res3.content.includes('Clash.Service'))
 return createToast('检查 Mihomo 核心依赖文件失败！', 'red');

 createToast('正在安装 Mihomo 核心并设置自启动...');
 const res5 = await runShellWithRoot(`
chmod 777 -Rf /data/clash
grep -qxF '/data/clash/Scripts/Clash.Service start' /sdcard/ufi_tools_boot.sh || echo '/data/clash/Scripts/Clash.Service start' >> /sdcard/ufi_tools_boot.sh
grep -qxF 'inotifyd /data/clash/Scripts/Clash.Inotify "/data/clash/Clash" >> /dev/null &' /sdcard/ufi_tools_boot.sh || echo 'inotifyd /data/clash/Scripts/Clash.Inotify "/data/clash/Clash" >> /dev/null &' >> /sdcard/ufi_tools_boot.sh
 `);
 if (!res5.success) return createToast('设置 Mihomo 核心自启动失败！', 'red');

 createToast('启动Clash...');
 const res6 = await runShellWithRoot(`
 /data/clash/Scripts/Clash.Service start
 `);
 if (!res6.success) return createToast('启动 Mihomo 核心失败！', 'red');

 disabled_btn_enabled = false;

 checkIsBootUp().then((isBootUp) => {
 const boot_on = document.querySelector('#clash_boot_on');
 if (!boot_on) return;
 if (isBootUp) {
 boot_on.style.background = 'var(--dark-btn-color-active)';
 } else {
 boot_on.style.background = '';
 }
 });
 setTimeout(() => {
 isMMRunning();
 }, 3000);

 await askConfirm(
 'mm_installed_confirm_1',
 '启动Clash成功',
 `web地址(端口默认是7788)<br />
 <a href="http://${UFI_DATA.lan_ipaddr}:7788/ui/" target="_blank">http://${UFI_DATA.lan_ipaddr}:7788/ui/</a><br />
 主机地址填:${UFI_DATA.lan_ipaddr}<br />
 密码默认为123456<br />
 端口填7788<br />
 第一次使用请点击编辑配置，按照说明操作，不然核心无法启动！<br />
 依赖文件路径:/data/clash/<br/>
 内核日志:sdcard/Clash内核日志.txt<br/>
 输出:${res6.content}`,
 'OK',
 );
 } finally {
 disabled_btn_enabled = false;
 await runShellWithRoot(`rm -f /data/kano_clash.zip`);
 }
 };
 const btn_disabled = document.createElement('button');
 btn_disabled.textContent = '卸载';
 let ct = 0;
 let tmer = null;
 btn_disabled.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 ct++;
 tmer && clearTimeout(tmer);
 tmer = setTimeout(() => {
 ct = 0;
 }, 3000);
 if (ct < 3) {
 return createToast('再点一次卸载 Mihomo 核心');
 }
 createToast('卸载中...', 'red');
 const res = await runShellWithRoot(`
 /data/clash/Scripts/Clash.Service stop
 sleep 1
 rm -rf /data/clash
 sed -i '/Clash.Service/d' /sdcard/ufi_tools_boot.sh
 sed -i '/Clash.Inotify/d' /sdcard/ufi_tools_boot.sh
 `);
 if (!res.success) return createToast('卸载失败！', 'red');
 createToast(`<div style="width:300px;text-align:center">
 卸载结果：${res.content}<br/>
 如果没有错误即视为卸载成功
 </div>`);
 await isMMRunning();
 };

 const btn_restart = document.createElement('button');
 btn_restart.textContent = '重启';
 btn_restart.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 createToast(
 '正在重启 Mihomo...<br/>如果等待时间比较久，请持续观察日志。',
 'green',
 );
 const res = await runShellWithRoot(
 `
 /data/clash/Scripts/Clash.Service stop
 sleep 1
 /data/clash/Scripts/Clash.Service start
 `,
 100 * 1000,
 );
 if (!res.success) return createToast('重启失败！', 'red');
 createToast(
 `<div style="width:300px;text-align:center">
 ${res.content.replaceAll('\n', '<br/>')}
 </div>`,
 'green',
 );
 await isMMRunning();
 };

 const uploadEl = document.createElement('input');
 uploadEl.type = 'file';
 uploadEl.onchange = async (e) => {
 if (!e?.target?.files) return;
 const file = e.target.files[0];
 if (file) {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 await runShellWithRoot(`
 rm /data/data/com.minikano.f50_sms/files/uploads/clash_config.yml
 `);
 if (file.size > 1 * 1024 * 1024) {
 createToast(`文件大小不能超过${1}MB！`, 'red');
 } else {
 try {
 await saveConfig(file);
 } finally {
 uploadEl.value = '';
 }
 }
 }
 };

 const editBtn = document.createElement('button');
 editBtn.classList.add('btn');
 editBtn.textContent = '编辑配置';
 editBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 const res = await runShellWithRoot(`
 timeout 5s awk '{print}' /data/clash/Proxy/config.yaml
 `);
 if (!res.success) return createToast('备份失败！', 'red');

 const { el, close } = createPluginToast(
 'kano_eidt_mm_message',
 `
 <div style="pointer-events:all;width:80vw;max-width:800px;">
 <div class="title" style="margin:0" data-i18n="system_notice">编辑 YAML</div>
 <div style="margin:10px 0" class="inner"></div>
 <div style="text-align:right">
 <button style="font-size:.64rem" id="save_eidt_mm_message_btn" data-i18n="plugin_modal_submit_btn">${t('plugin_modal_submit_btn')}</button>
 <button style="font-size:.64rem" id="close_eidt_mm_message_btn" data-i18n="close_btn">${t('close_btn')}</button>
 </div>
 </div>
 `,
 );

 const textarea = document.createElement('textarea');
 textarea.style.width = '100%';
 textarea.style.height = '500px';
 textarea.style.maxHeight = '60vh';
 textarea.style.border = 'none';
 textarea.style.background = '#000000cc';
 textarea.style.color = '#0f0';
 textarea.style.boxSizing = 'border-box';
 textarea.style.fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif';
 textarea.style.lineHeight = '1.4';
 textarea.value = res.content;
 el.querySelector('.inner').appendChild(textarea);
 const btn = el.querySelector('#close_eidt_mm_message_btn');
 const sbtn = el.querySelector('#save_eidt_mm_message_btn');
 if (!btn) {
 close();
 return;
 }
 btn.onclick = async () => {
 close();
 };
 sbtn.onclick = async () => {
 const v = textarea.value;
 if (!v || v.trim().length == 0) {
 return createToast('配置不能为空！', 'red');
 }
 createToast('正在保存...', '');
 const file = new File([v], 'config.yaml', { type: 'text/plain' });
 if (!(await saveConfig(file))) {
 return;
 }
 close();
 };
 };

 const uploadBtn = document.createElement('button');
 uploadBtn.classList.add('btn');
 uploadBtn.textContent = '上传配置';
 uploadBtn.onclick = async () => {
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 uploadEl.click();
 };

 const stopBtn = document.createElement('button');
 stopBtn.classList.add('btn');
 stopBtn.textContent = '停止';
 stopBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 createToast('正在停止 Mihomo...', 'green');
 const res = await runShellWithRoot(`
 /data/clash/Scripts/Clash.Service stop
 sleep 1
 `);
 if (!res.success) return createToast('停止失败！', 'red');
 createToast(
 `<div style="width:300px;text-align:center">
 ${res.content.replaceAll('\n', '<br/>')}
 </div>`,
 'green',
 );
 await isMMRunning();
 };

 const backupBtn = document.createElement('button');
 backupBtn.classList.add('btn');
 backupBtn.textContent = '备份配置';
 backupBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 createToast('正在备份 Mihomo 配置...', 'green');
 const t = Math.floor(Date.now() + Math.random());
 const res = await runShellWithRoot(`
 rm -f /data/data/com.minikano.f50_sms/files/uploads/mm_config_backup*
 sleep 1
 cp /data/clash/Proxy/config.yaml /data/data/com.minikano.f50_sms/files/uploads/mm_config_backup_${t}.yaml
 chmod 777 /data/data/com.minikano.f50_sms/files/uploads/mm_config_backup_${t}.yaml
 `);
 if (!res.success) return createToast('备份失败！', 'red');
 const a = document.createElement('a');
 a.download = `UFI-Mihomo-config-backup_${t}.yaml`;
 a.href = `/api/uploads/mm_config_backup_${t}.yaml`;
 a.target = '_blank';
 a.style.display = 'none';
 document.body.appendChild(a);
 a.click();
 a.remove();
 };

 (async () => {
 const wait = (sec = 100) =>
 new Promise((resolve) => {
 setTimeout(() => {
 resolve();
 }, sec);
 });
 const mmContainer = document.querySelector('.functions-container');
 while (!UFI_DATA.lan_ipaddr) {
 await wait();
 }

 mmContainer.insertAdjacentHTML(
 'afterend',
 `
<div id="IFRAME_KANO" style="width: 100%; margin-top: 10px;">
 <div class="title" style="margin: 6px 0 ;">
 <strong id="running_mm">Clash for UFI</strong>
 <div style="display: inline-block;" id="collapse_mm_btn"></div>
 </div>
 <div class="collapse" id="collapse_mm" data-name="close" style="height: 0px; overflow: hidden;">
 <div class="collapse_box">
 <div id="mm_action_box" style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap"></div>
 <ul class="deviceList">
<li style="padding:10px">
 <iframe id="mm_iframe" src="javascript:;" style="border:none;padding:0;margin:0;width:100%;height:500px;border-radius: 10px;overflow: hidden;opacity: .6;"></iframe>
</li> </ul>
 </div>
 </div>
</div>
`,
 );
 const refresh = document.createElement('button');
 refresh.classList.add('btn');
 refresh.textContent = '刷新网页';
 refresh.onclick = () => {
 document.getElementById('mm_iframe').src =
 `http://${UFI_DATA.lan_ipaddr}:7788/ui/?t=` + Date.now();
 };

 const open = document.createElement('button');
 open.classList.add('btn');
 open.textContent = '打开面板';
 open.onclick = () => {
 const a = document.createElement('a');
 a.href = `http://${UFI_DATA.lan_ipaddr}:7788/ui/?t=` + Date.now();
 a.target = '_blank';
 a.style.display = 'none';
 document.body.appendChild(a);
 a.click();
 a.remove();
 };

 const wiki = document.createElement('button');
 wiki.classList.add('btn');
 wiki.textContent = '文档教程';
 wiki.onclick = () => {
 const a = document.createElement('a');
 a.href = `https://wiki.metacubex.one/config/`;
 a.target = '_blank';
 a.style.display = 'none';
 document.body.appendChild(a);
 a.click();
 a.remove();
 };

 const boot_on = document.createElement('button');
 boot_on.id = 'clash_boot_on';
 boot_on.classList.add('btn');
 boot_on.textContent = '开机自启';
 boot_on.style.background = '';
 boot_on.addEventListener('click', async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 const isBootUp = await checkIsBootUp();
 if (isBootUp) {
 await runShellWithRoot(`
 sed -i '/Clash.Service/d' /sdcard/ufi_tools_boot.sh
 sed -i '/Clash.Inotify/d' /sdcard/ufi_tools_boot.sh
 `);
 boot_on.style.background = '';
 createToast('已取消开机自启', 'green');
 } else {
 await runShellWithRoot(`
 grep -qxF '/data/clash/Scripts/Clash.Service start' /sdcard/ufi_tools_boot.sh || echo '/data/clash/Scripts/Clash.Service start' >> /sdcard/ufi_tools_boot.sh
 grep -qxF 'inotifyd /data/clash/Scripts/Clash.Inotify "/data/clash/Clash" >> /dev/null &' /sdcard/ufi_tools_boot.sh || echo 'inotifyd /data/clash/Scripts/Clash.Inotify "/data/clash/Clash" >> /dev/null &' >> /sdcard/ufi_tools_boot.sh
 `);
 boot_on.style.background = 'var(--dark-btn-color-active)';
 createToast('已设置开机自启', 'green');
 }
 });

 checkIsBootUp().then((isBootUp) => {
 if (isBootUp) {
 boot_on.style.background = 'var(--dark-btn-color-active)';
 } else {
 boot_on.style.background = '';
 }
 });

 if (localStorage.getItem('#collapse_mm') == 'open') {
 refresh.click();
 await isMMRunning();
 }

 const uploadCore = document.createElement('button');
 uploadCore.textContent = '📤 上传内核';
 uploadCore.title = '直连 Debug 端口 (17789) 上传自定义 ARM64 ELF 或 .gz 内核，不走 2333 平台上传限制；自动 -t 预检与备份回滚';
 const uploadCoreInput = document.createElement('input');
 uploadCoreInput.type = 'file';
 uploadCoreInput.accept = '*/*,.gz';
 uploadCoreInput.style.display = 'none';

 uploadCoreInput.onchange = async (e) => {
 e.stopPropagation();
 if (!e.target || !e.target.files || e.target.files.length === 0) return;
 const file = e.target.files[0];
 if (!file) return;
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 uploadCoreInput.value = '';
 return;
 }
 if (file.size > 120 * 1024 * 1024) {
 createToast('文件大小不能超过 120MB！', 'red');
 uploadCoreInput.value = '';
 return;
 }
 const head = new Uint8Array(await file.slice(0, 20).arrayBuffer());
 const isGz = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
 const isArm64Elf = head.length >= 20 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46 && head[18] === 0xb7 && head[19] === 0x00;
 if (!isGz && !isArm64Elf) {
 createToast('仅支持 ARM64 ELF 二进制或 .gz 压缩内核包！', 'red');
 uploadCoreInput.value = '';
 return;
 }

 const { close } = createPluginToast('upload_core_toast', `正在直连 17789 上传内核 (${(file.size / 1048576).toFixed(1)} MB)…`);
 try {
 await runRootChecked('/data/clash/Scripts/debug_service.sh start', 10000);
 const tokRes = await runRootChecked('/data/clash/Scripts/debug_service.sh token', 6000);
 const tok = (tokRes.content || '').trim();
 if (!tok) throw new Error('未能读取 Debug Token');
 const ip = (typeof UFI_DATA !== 'undefined' && UFI_DATA.lan_ipaddr) ? UFI_DATA.lan_ipaddr : location.hostname;
 const res = await fetch(`http://${ip}:17789/v1/core/upload`, {
 method: 'POST',
 headers: {
 'Authorization': `Bearer ${tok}`,
 'Content-Type': 'application/octet-stream',
 },
 body: file,
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok || !data.ok) {
 throw new Error(data.error || data.output || `HTTP ${res.status}`);
 }
 createToast(`内核已切换并启动：${data.version || 'OK'}`, 'green', 6500);
 await isMMRunning();
 } catch (err) {
 console.error(err);
 createToast(`上传内核失败: ${err?.message || err}`, 'red', 7000);
 } finally {
 uploadCoreInput.value = '';
 close();
 }
 };

 uploadCore.onclick = async () => {
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 uploadCoreInput.click();
 };

 const showLogBtn = document.createElement('button');
 showLogBtn.textContent = '查看日志';
 showLogBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 return createToast('没有开启高级功能，无法使用！');
 }

 const res = await runShellWithRoot(`
 timeout 2s awk \'{print}\' /sdcard/Clash内核日志.txt | tail -n 100
 `);
 if (!res.success) return createToast('获取日志失败！', 'red');
 if (!res.content) return createToast('日志内容为空！', 'red');
 showDialog(res.content, 'Mihomo 日志 (tail 100)');
 };

 // ============================================================
 // 🆕 下载官方内核(Hysteria2支持)
 // ============================================================
 const dlCoreBtn = document.createElement('button');
 dlCoreBtn.classList.add('btn');
 dlCoreBtn.textContent = '💾 官方内核';
 dlCoreBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }

 createToast('检测CPU架构...', '');
 const archRes = await runRootChecked(`uname -m`);
 if (!archRes.success) {
 createToast('CPU 架构检测失败：' + (archRes.content || '未知错误'), 'red');
 return;
 }
 let arch = (archRes.content || '').trim();
 let gzName;
 const coreVersion = 'v1.19.27';
 if (arch === 'aarch64' || arch === 'arm64') {
 gzName = `mihomo-android-arm64-v8-${coreVersion}.gz`;
 } else if (arch === 'armv7l' || arch === 'armv7' || arch === 'armv8l') {
 gzName = `mihomo-android-armv7-${coreVersion}.gz`;
 } else if (arch === 'x86_64' || arch === 'amd64') {
 gzName = `mihomo-android-amd64-${coreVersion}.gz`;
 } else {
 createToast('不支持的架构: ' + arch, 'red');
 return;
 }

 const url = `https://github.com/MetaCubeX/mihomo/releases/download/${coreVersion}/${gzName}`;
 const outPath = '/data/kano_mihomo_new.gz';
 const unpackedPath = '/data/kano_mihomo_new';
 const corePath = '/data/clash/Proxy/Clash.Core';
 const backupPath = '/data/clash/Proxy/Clash.Core.ufi-proxy-studio-backup';

 createToast('下载官方mihomo v1.19.27...', '');
 const dlRes = await runRootChecked(`
 rm -f "${outPath}" "${unpackedPath}"
 curl --fail --location --retry 2 --retry-delay 2 \
   "${url}" -o "${outPath}" --connect-timeout 30 --max-time 120
 test -s "${outPath}"
 gzip -t "${outPath}"
 `, 140 * 1000);

 if (!dlRes.success) {
 createToast('下载或压缩包校验失败：' + (dlRes.content || '未知错误'), 'red', 8000);
 return;
 }

 createToast('替换内核...', '');
 const repRes = await runRootChecked(`
 gzip -dc "${outPath}" > "${unpackedPath}"
 chmod 755 "${unpackedPath}"
 "${unpackedPath}" -v >/dev/null
 cp -f "${corePath}" "${backupPath}"
 /data/clash/Scripts/Clash.Service stop 2>/dev/null || true
 sleep 1
 mv -f "${unpackedPath}" "${corePath}"
 chmod 755 "${corePath}"
 if ! /data/clash/Scripts/Clash.Service start >/dev/null 2>&1; then
   cp -f "${backupPath}" "${corePath}"
   chmod 755 "${corePath}"
   /data/clash/Scripts/Clash.Service start >/dev/null 2>&1 || true
   exit 21
 fi
 sleep 3
 if ! pgrep -f '[C]lash.Core' >/dev/null; then
   /data/clash/Scripts/Clash.Service stop 2>/dev/null || true
   cp -f "${backupPath}" "${corePath}"
   chmod 755 "${corePath}"
   /data/clash/Scripts/Clash.Service start >/dev/null 2>&1 || true
   exit 22
 fi
 rm -f "${outPath}" "${unpackedPath}"
 echo CORE_UPDATED
 `, 45 * 1000);

 if (!repRes.success) {
 createToast('替换失败，已尝试恢复旧内核：' + (repRes.content || '未知错误'), 'red', 8000);
 return;
 }

 createToast('✅ 内核已更新并通过启动检查（旧内核已备份）', 'green');
 };

 // ============================================================
 // 🆕 自建节点按钮
 // ============================================================
 const selfNodeBtn = document.createElement('button');
 selfNodeBtn.classList.add('btn');
 selfNodeBtn.textContent = '🔗 自建节点';
 selfNodeBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 showNodeInputDialog();
 };

 // ============================================================
 // 原版 订阅链接功能 保留
 // ============================================================
 const importSub = async () => {
 const { el, close } = createPluginToast(
 'mm_sub_input_toast',
 `
 <div style="pointer-events:all;width:80vw;max-width:800px;">
 <div class="title" style="margin:0">订阅链接</div>
 <div style="margin:20px 0;display: flex;flex-direction: column;gap: 10px;">
 <input id="mm_sub_url1_input" type="text" placeholder="请输入你的订阅链接1" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:4px;outline:none;">
 <input id="mm_sub_url2_input" type="text" placeholder="请输入你的订阅链接2(可选)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:4px;outline:none;">
 <input id="mm_sub_url3_input" type="text" placeholder="请输入你的订阅链接3(可选)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:4px;outline:none;">
 </div>
 <div style="text-align:right">
 <button style="font-size:.64rem" id="mm_sub_submit_btn">提交</button>
 <button style="font-size:.64rem" id="mm_sub_close_btn">关闭</button>
 </div>
 </div>
 `,
 );

 const url1Input = el.querySelector('#mm_sub_url1_input');
 const url2Input = el.querySelector('#mm_sub_url2_input');
 const url3Input = el.querySelector('#mm_sub_url3_input');

 el.querySelector('#mm_sub_close_btn').onclick = close;
 el.querySelector('#mm_sub_submit_btn').onclick = async () => {
 const url1 = url1Input.value.trim();
 const url2 = url2Input.value.trim();
 const url3 = url3Input.value.trim();

 if (!url1) {
 createToast('请至少输入订阅链接1！！', 'red');
 return;
 }

 createToast('正在处理订阅...', 'yellow');

 try {
 let res = `${url1}`;
 if (url2) {
 res = `${url1} ${url2}\nprovider1 provider2`;
 }
 if (url3) {
 res = `${url1} ${url2} ${url3}\nprovider1 provider2 provider3`;
 }
 const file = new File([res], 'config.yaml', { type: 'text/plain' });
 const success = await saveConfig(file, { validate: false });

 if (success) {
 close();
  try {
   const current = await persistCurrentSubscriptionSource(res);
   if (current.bound) createToast('订阅已应用，当前链接已记录。', 'green', 6500);
   else if (current.sourceCount !== 1) createToast('订阅已应用；当前包含多条来源，暂不能确定单一热刷新目标。', 'orange', 7000);
   else if (current.reasonCode === 'REFRESH_SERVICE_UNAVAILABLE') createToast('订阅已应用，当前链接已记录；受限热刷新服务尚未安装或不可用。', 'orange', 7000);
   else createToast('订阅已应用，当前链接已记录；刷新服务或链接校验尚未就绪。', 'orange', 7000);
  } catch (_) {
   createToast('订阅已应用，但当前链接记录未完成；热刷新不可用，请重新提交当前链接。', 'orange', 8000);
  }
  void updateSubscriptionRefreshButton();
 }
 } catch (e) {
 createToast('处理订阅失败: ' + e, 'red');
 }
 };
 };

 const subBtn = document.createElement('button');
 subBtn.classList.add('btn');
 subBtn.textContent = '订阅链接';
 subBtn.onclick = async () => {
 if (!(await checkAdvanceFunc())) {
 createToast('没有开启高级功能，无法使用！', 'red');
 return;
 }
 if (!(await checkIsInstalled())) {
 createToast('未检测到 Mihomo 服务，请先安装运行核心', 'red');
 return;
 }
 importSub();
 };

 const settingsBtn = document.createElement('button');
 settingsBtn.classList.add('btn');
 settingsBtn.textContent = '⚙️ 参数设置';
 settingsBtn.onclick = () => showPluginSettingsDialog();

 const profilesBtn = document.createElement('button');
 profilesBtn.classList.add('btn');
 profilesBtn.textContent = '🗂️ 配置库';
 profilesBtn.onclick = () => showProfileManagerDialog();

 const refreshCurrentSubscriptionBtn = document.createElement('button');
 refreshCurrentSubscriptionBtn.classList.add('btn');
  refreshCurrentSubscriptionBtn.textContent = '需要重新导入当前订阅';
 refreshCurrentSubscriptionBtn.disabled = true;
  refreshCurrentSubscriptionBtn.title = '旧安装没有由当前插件写入的来源记录；请从现有“订阅链接”入口重新提交当前链接。';
 refreshCurrentSubscriptionBtn.style.opacity = '.58';
 const pendingSubscriptionRefreshKey = 'ufi_proxy_studio_pending_subscription_refresh_v1';
 const readPendingSubscriptionRefresh = () => {
  try {
   const value = sessionStorage.getItem(pendingSubscriptionRefreshKey) || '';
   return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : '';
  } catch (_) { return ''; }
 };
 const setPendingSubscriptionRefresh = (value) => {
  try {
   if (value) sessionStorage.setItem(pendingSubscriptionRefreshKey, value);
   else sessionStorage.removeItem(pendingSubscriptionRefreshKey);
  } catch (_) {}
 };
 const makeSubscriptionRequestId = () => {
  if (crypto.randomUUID) return crypto.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 };
 const showSubscriptionRefreshOutcome = (response) => {
  const state = response?.data?.status || response?.data?.state || '';
  if (state === 'applied') createToast('当前订阅已热加载，回读核验完成。', 'green', 6500);
  else if (state === 'unchanged') createToast('订阅未变化，未执行热加载。', 'blue', 5500);
  else if (state === 'unknown' || response?.error?.completionUnknown) createToast('刷新回执未知；请核对同一请求结果，不要重复提交。', 'orange', 8000);
  else if (state === 'unbound' || response?.data?.enabled === false) createToast('无法确认当前订阅；刷新已禁用。', 'orange', 6500);
  else createToast('当前订阅刷新未完成；活动配置未报告为成功。', 'red', 6500);
 };
 const updateSubscriptionRefreshButton = async () => {
  const pendingId = readPendingSubscriptionRefresh();
  refreshCurrentSubscriptionBtn.disabled = true;
  refreshCurrentSubscriptionBtn.style.opacity = '.58';
   refreshCurrentSubscriptionBtn.textContent = pendingId ? '正在核对上次刷新…' : '正在读取当前订阅状态…';
  try {
   if (pendingId) {
    refreshCurrentSubscriptionBtn.disabled = false;
    refreshCurrentSubscriptionBtn.textContent = '核对上次刷新结果';
    refreshCurrentSubscriptionBtn.title = '仅查询同一请求号的结果，不会重新提交刷新。';
    refreshCurrentSubscriptionBtn.style.opacity = '';
    refreshCurrentSubscriptionBtn.onclick = async () => {
     refreshCurrentSubscriptionBtn.disabled = true;
     try {
      const result = await runSubscriptionBridge('check', pendingId);
      const state = result?.data?.status || result?.data?.state || '';
      if (state === 'unknown' || state === 'running' || result?.error?.completionUnknown) {
       showSubscriptionRefreshOutcome({ ...result, data: { ...(result.data || {}), status: 'unknown' } });
      } else {
       setPendingSubscriptionRefresh('');
       showSubscriptionRefreshOutcome(result);
       await updateSubscriptionRefreshButton();
      }
     } catch (_) {
      showSubscriptionRefreshOutcome({ data: { status: 'unknown' } });
      refreshCurrentSubscriptionBtn.disabled = false;
     }
    };
    return;
   }
    let result = await runSubscriptionBridge('status');
    if (result?.ok && result?.data?.bindingPending === true) {
     try {
      const binding = await runSubscriptionBridge('bind');
      if (binding?.ok && binding?.data?.bound === true) result = await runSubscriptionBridge('status');
     } catch (_) {}
    }
   if (result?.ok && result?.data?.enabled === true) {
    refreshCurrentSubscriptionBtn.disabled = false;
    refreshCurrentSubscriptionBtn.style.opacity = '';
    refreshCurrentSubscriptionBtn.textContent = '刷新当前订阅';
     refreshCurrentSubscriptionBtn.title = '只重新下载当前已记录的订阅链接，校验配置并请求 Mihomo 热加载。';
    refreshCurrentSubscriptionBtn.onclick = async () => {
     let fresh = null;
     try { fresh = await runSubscriptionBridge('status'); } catch (_) {}
     if (!fresh?.ok || fresh?.data?.enabled !== true) {
       await updateSubscriptionRefreshButton();
      return;
     }
      const confirmed = await askConfirm('active_subscription_refresh_confirm', '刷新当前订阅', '将重新下载当前订阅链接，校验返回的 Home 配置，备份当前配置并请求 Mihomo 热加载。此操作不会切换来源，也不会停止或启动 Clash.Service。', '刷新', '取消');
     if (!confirmed) return;
     const requestId = makeSubscriptionRequestId();
     setPendingSubscriptionRefresh(requestId);
     refreshCurrentSubscriptionBtn.disabled = true;
     refreshCurrentSubscriptionBtn.textContent = '正在刷新当前订阅…';
     try {
      const outcome = await runSubscriptionBridge('refresh', requestId);
      const state = outcome?.data?.status || outcome?.data?.state || '';
      showSubscriptionRefreshOutcome(outcome);
      if (state === 'unknown' || state === 'running' || outcome?.error?.completionUnknown) {
       refreshCurrentSubscriptionBtn.disabled = false;
       refreshCurrentSubscriptionBtn.textContent = '核对上次刷新结果';
       refreshCurrentSubscriptionBtn.title = '仅查询同一请求号的结果，不会重新提交刷新。';
       refreshCurrentSubscriptionBtn.onclick = async () => {
        refreshCurrentSubscriptionBtn.disabled = true;
        try {
         const check = await runSubscriptionBridge('check', requestId);
         const checkedState = check?.data?.status || check?.data?.state || '';
         if (checkedState === 'unknown' || checkedState === 'running' || check?.error?.completionUnknown) {
          showSubscriptionRefreshOutcome({ ...check, data: { ...(check.data || {}), status: 'unknown' } });
          refreshCurrentSubscriptionBtn.disabled = false;
         } else {
          setPendingSubscriptionRefresh('');
          showSubscriptionRefreshOutcome(check);
          await updateSubscriptionRefreshButton();
         }
        } catch (_) {
         showSubscriptionRefreshOutcome({ data: { status: 'unknown' } });
         refreshCurrentSubscriptionBtn.disabled = false;
        }
       };
      } else {
       setPendingSubscriptionRefresh('');
       await updateSubscriptionRefreshButton();
      }
     } catch (_) {
      showSubscriptionRefreshOutcome({ data: { status: 'unknown' } });
      refreshCurrentSubscriptionBtn.disabled = false;
      refreshCurrentSubscriptionBtn.textContent = '核对上次刷新结果';
      refreshCurrentSubscriptionBtn.title = '仅查询同一请求号的结果，不会重新提交刷新。';
     }
    };
   } else {
    refreshCurrentSubscriptionBtn.disabled = true;
    refreshCurrentSubscriptionBtn.style.opacity = '.58';
     const code = result?.data?.reasonCode || '';
     const reason = result?.data?.reasonText || '';
     if (code === 'CURRENT_SOURCE_AMBIGUOUS') {
      refreshCurrentSubscriptionBtn.textContent = '当前订阅含多条来源';
      refreshCurrentSubscriptionBtn.title = reason || '当前入口包含多条链接，暂不能确定单一刷新目标。';
     } else if (code === 'CURRENT_SOURCE_UNSUPPORTED') {
      refreshCurrentSubscriptionBtn.textContent = '当前链接暂不支持热刷';
      refreshCurrentSubscriptionBtn.title = reason || '热刷新只接受安全的 HTTPS 订阅链接。';
     } else if (result?.data?.migrationRequired === true) {
      refreshCurrentSubscriptionBtn.textContent = '需要重新导入当前订阅';
      refreshCurrentSubscriptionBtn.title = reason || '旧安装没有由当前插件写入的来源记录；请从现有“订阅链接”入口重新提交当前链接。';
     } else if (result?.data?.status === 'bound-disabled' || result?.data?.currentSourceRecorded === true) {
      refreshCurrentSubscriptionBtn.textContent = '热刷新尚未启用';
      refreshCurrentSubscriptionBtn.title = reason || '当前链接已记录，设备刷新服务仍未通过审查。';
     } else {
      refreshCurrentSubscriptionBtn.textContent = '需要重新导入当前订阅';
      refreshCurrentSubscriptionBtn.title = reason || '旧安装没有由当前插件写入的来源记录；请从现有“订阅链接”入口重新提交当前链接。';
     }
   }
  } catch (_) {
   refreshCurrentSubscriptionBtn.disabled = true;
   refreshCurrentSubscriptionBtn.style.opacity = '.58';
    const localState = await localCurrentSubscriptionState();
    if (localState === 'RECORDED') {
     refreshCurrentSubscriptionBtn.textContent = '刷新服务不可用';
     refreshCurrentSubscriptionBtn.title = '当前订阅链接已安全记录；受限热刷新后端尚未安装或暂不可用。';
    } else if (localState === 'AMBIGUOUS') {
     refreshCurrentSubscriptionBtn.textContent = '当前订阅含多条来源';
     refreshCurrentSubscriptionBtn.title = '当前链接包含多条来源；受限热刷新服务不可用，无法确定单一目标。';
    } else {
     refreshCurrentSubscriptionBtn.textContent = '需要重新导入当前订阅';
     refreshCurrentSubscriptionBtn.title = '未找到当前插件记录的订阅来源；受限热刷新服务不可用。请从现有“订阅链接”入口重新提交当前链接。';
    }
  }
 };
 refreshCurrentSubscriptionBtn.onclick = () => {};
 void updateSubscriptionRefreshButton();

 const shellQuote = (value) => `'${String(value ?? '').replaceAll("'", "'\"'\"'")}'`;

 const runDeviceCurl = async (argumentsText, timeout = 30000, fail = true) => {
  const failFlag = fail ? '--fail' : '';
  return runRootChecked(`
  curl_bin=/data/data/com.minikano.f50_sms/files/curl
  if [ ! -x "$curl_bin" ]; then curl_bin=$(command -v curl 2>/dev/null || true); fi
  [ -n "$curl_bin" ] && [ -x "$curl_bin" ] || { echo "curl 不可用"; exit 40; }
  "$curl_bin" ${failFlag} --silent --show-error ${argumentsText}
  `, timeout);
 };

 const parseCurlMetrics = (value) => {
  const text = String(value || '');
  const valueOf = (key) => {
   const match = text.match(new RegExp(`${key}=([0-9.]+)`));
   return match ? Number(match[1]) : NaN;
  };
  return {
   http: valueOf('HTTP'),
   dns: valueOf('DNS'),
   connect: valueOf('CONNECT'),
   tls: valueOf('TLS'),
   total: valueOf('TOTAL'),
  };
 };

 const formatCurlMetrics = (result) => {
  if (!result.success) return `失败：${String(result.content || '请求失败').trim()}`;
  const metrics = parseCurlMetrics(result.content);
  if (!Number.isFinite(metrics.http)) return String(result.content || '无响应').trim();
  return `HTTP ${metrics.http} | DNS ${metrics.dns.toFixed(3)}s | TCP ${metrics.connect.toFixed(3)}s | TLS ${metrics.tls.toFixed(3)}s | 总计 ${metrics.total.toFixed(3)}s`;
 };

 const showChainDiagnosticDialog = () => {
  const { el, close } = createPluginToast(
   'ufi_proxy_studio_chain_diagnostic',
   `<div style="pointer-events:all;width:90vw;max-width:840px">
    <div class="title" style="margin:0">🔍 Clash for UFI 全链路测试</div>
    <div style="margin:8px 0;font-size:.6rem;line-height:1.65;opacity:.88">
     隐私：不会上传 YAML、订阅、密钥或节点链接；控制器信息与测试结果仅显示在当前浏览器。基础测试仅向公开连通性地址发起普通请求，对方会看到正常的直连或代理出口 IP。负载抖动测试会额外下载最多约 12MB 数据，需单独确认。
    </div>
    <textarea id="ufi_chain_diag_output" readonly spellcheck="false" style="width:100%;height:430px;box-sizing:border-box;resize:vertical;background:rgba(0,0,0,.78);color:#b9f6ca;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px;font:12px/1.5 monospace"></textarea>
    <div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
     <button id="ufi_chain_diag_copy">复制结果</button><button id="ufi_chain_diag_run">基础测试</button><button id="ufi_chain_diag_direct">DIRECT 拨号诊断</button><button id="ufi_chain_diag_load">负载抖动测试</button><button id="ufi_chain_diag_close">关闭</button>
    </div>
   </div>`,
  );
  const output = el.querySelector('#ufi_chain_diag_output');
  const copyButton = el.querySelector('#ufi_chain_diag_copy');
  const runButton = el.querySelector('#ufi_chain_diag_run');
  const directButton = el.querySelector('#ufi_chain_diag_direct');
  const loadButton = el.querySelector('#ufi_chain_diag_load');
  const closeButton = el.querySelector('#ufi_chain_diag_close');
  let running = false;
  let latestRuntime = null;

  const setOutput = (lines) => {
   if (!output) return;
   output.value = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
   output.scrollTop = output.scrollHeight;
  };

  const browserProbe = async (url) => {
   const started = performance.now();
   const separator = url.includes('?') ? '&' : '?';
   try {
    const request = typeof originFetch === 'function' ? originFetch : fetch;
    const response = await request(`${url}${separator}ufi_chain_diag=${Date.now()}`, {
     cache: 'no-store',
     mode: 'no-cors',
    });
    return `${Math.round(performance.now() - started)} ms (${response.type || 'ok'})`;
   } catch (error) {
    return `失败：${String(error?.message || error)}`;
   }
  };

  const selectedChain = (snapshot) => {
   const proxyMap = snapshot?.proxies || {};
   const rootName = ['PROXY', 'Proxy', 'GLOBAL'].find((name) => proxyMap[name]?.now)
    || Object.keys(proxyMap).find((name) => proxyMap[name]?.type === 'Selector' && proxyMap[name]?.now);
   const steps = [];
   let current = rootName || '';
   const seen = new Set();
   while (current && !seen.has(current) && steps.length < 8) {
    seen.add(current);
    const item = proxyMap[current];
    if (!item) break;
    steps.push({ name: current, now: item.now || item.type || '未知' });
    if (!item.now || !proxyMap[item.now]) break;
    current = item.now;
   }
   return { steps, leaf: current && proxyMap[current] ? current : '' };
  };

  const runBasicTest = async () => {
   if (running) return;
   running = true;
   runButton && (runButton.disabled = true);
   directButton && (directButton.disabled = true);
   loadButton && (loadButton.disabled = true);
   const lines = [
    'Clash for UFI 全链路测试',
    `时间：${new Date().toLocaleString()}`,
    '隐私：未读取或输出订阅、密钥、UUID、服务器地址及出口 IP。',
    '',
    '正在读取本机运行状态…',
   ];
   setOutput(lines);
   try {
    const configResult = await runRootChecked('test -s /data/clash/Proxy/config.yaml && cat /data/clash/Proxy/config.yaml', 15000);
    if (!configResult.success) throw new Error(configResult.content || '无法读取当前配置');
    const configText = String(configResult.content || '');
    const runtime = readSettingsFromConfig(configText, loadPluginSettings());
    const hasTun = /^tun:\s*$/m.test(configText) && findNestedValue(configText, 'tun', 'enable') === true;
    const tproxyPort = Number(findTopLevelValue(configText, 'tproxy-port') || 0);
    const mixedPort = Number(findTopLevelValue(configText, 'mixed-port') || findTopLevelValue(configText, 'port') || 7890);
    const controllerPort = Number(runtime.controllerPort || 7788);
    latestRuntime = { mixedPort, controllerPort, controllerSecret: runtime.controllerSecret || '' };
    lines.length = 0;
    lines.push('Clash for UFI 全链路测试', `时间：${new Date().toLocaleString()}`);
    lines.push('隐私：未读取或输出订阅、密钥、UUID、服务器地址及出口 IP。');
    lines.push('');
    lines.push('【接管方式】');
    lines.push(hasTun ? `TUN（${runtime.tunStack}，MTU ${runtime.mtu}）` : `TProxy（端口 ${tproxyPort || '未发现'}）`);
    lines.push(`mixed-port：${mixedPort}；Sniffer：${runtime.sniffer ? '开启' : '关闭'}；DNS fake-IP：${runtime.fakeIpRange}`);
    const interfaceResult = await runRootChecked('ip -o link show sipa_eth8 2>/dev/null || true; ip route get 1.1.1.1 2>/dev/null || true', 10000);
    lines.push(`上行接口：${String(interfaceResult.content || '无法读取').replace(/\n+/g, ' | ').trim()}`);

    const probeUrl = 'https://www.gstatic.com/generate_204';
    const curlFormat = 'HTTP=%{http_code} DNS=%{time_namelookup} CONNECT=%{time_connect} TLS=%{time_appconnect} TOTAL=%{time_total}';
    const probeArgs = `--connect-timeout 8 --max-time 20 --output /dev/null --write-out ${shellQuote(curlFormat)} ${shellQuote(`${probeUrl}?ufi_chain_diag=${Date.now()}`)}`;
    const directResult = await runDeviceCurl(`--noproxy '*' ${probeArgs}`, 25000, false);
    const mixedResult = await runDeviceCurl(`--proxy ${shellQuote(`http://127.0.0.1:${mixedPort}`)} ${probeArgs}`, 25000, false);
    lines.push('', '【U30 本机出站】');
    lines.push(`未指定 HTTP 代理：${formatCurlMetrics(directResult)}（TProxy 规则仍可能接管本机流量）`);
    lines.push(`明确走 Mihomo mixed-port：${formatCurlMetrics(mixedResult)}`);

    const controllerHeaders = runtime.controllerSecret
     ? `--header ${shellQuote(`Authorization: Bearer ${runtime.controllerSecret}`)}`
     : '';
    const controllerBase = `http://127.0.0.1:${controllerPort}`;
    const controllerResult = await runDeviceCurl(`${controllerHeaders} --connect-timeout 5 --max-time 10 ${shellQuote(`${controllerBase}/proxies`)}`, 15000, false);
    let chain = { steps: [], leaf: '' };
    if (controllerResult.success) {
     try { chain = selectedChain(JSON.parse(controllerResult.content)); } catch (_) { /* no controller data */ }
    }
    lines.push('', '【Mihomo 当前策略链】');
    lines.push(chain.steps.length
     ? chain.steps.map((step) => `${step.name} → ${step.now}`).join('\n')
     : `无法读取策略链：${String(controllerResult.content || '控制器无响应').trim()}`);
    if (chain.leaf && chain.leaf !== 'DIRECT' && chain.leaf !== 'REJECT') {
     const delayUrl = `${controllerBase}/proxies/${encodeURIComponent(chain.leaf)}/delay?timeout=10000&url=${encodeURIComponent(probeUrl)}`;
     const delayResult = await runDeviceCurl(`${controllerHeaders} --connect-timeout 5 --max-time 15 ${shellQuote(delayUrl)}`, 20000, false);
     let delay = String(delayResult.content || '').trim();
     try { delay = `${JSON.parse(delay).delay} ms`; } catch (_) { /* preserve the diagnostic response */ }
     lines.push(`当前叶节点控制器延迟：${delayResult.success ? delay : `失败：${delay}`}`);
    }

    lines.push('', '【当前浏览器／热点客户端】');
    lines.push(`Google 204：${await browserProbe(probeUrl)}`);
    lines.push('', '【解读】');
    const directMetrics = parseCurlMetrics(directResult.content);
    const mixedMetrics = parseCurlMetrics(mixedResult.content);
    if (!directResult.success || !Number.isFinite(directMetrics.total)) {
     lines.push('U30 本机基础出站异常：先检查 5G 信号、运营商链路与设备自身网络。');
    } else if (!mixedResult.success || !Number.isFinite(mixedMetrics.total)) {
     lines.push('本机基础出站正常、明确走 Mihomo 异常：优先检查策略组、节点或 Mihomo 转发。');
    } else if (mixedMetrics.total > directMetrics.total * 3 && mixedMetrics.total > 2) {
     lines.push('Mihomo 明显慢于本机出站：优先检查节点、国际路径或代理协议。');
    } else {
     lines.push('本机两段均基本连通；若客户端仍慢，请运行负载抖动测试，并比较 TProxy 保留、策略组切 DIRECT 的结果。');
    }
   } catch (error) {
    lines.push('', `测试失败：${String(error?.message || error)}`);
   } finally {
    setOutput(lines);
    running = false;
    runButton && (runButton.disabled = false);
    directButton && (directButton.disabled = false);
    loadButton && (loadButton.disabled = false);
   }
  };

  const runDirectDialDiagnostic = async () => {
   const confirmed = await askConfirm(
    'ufi_chain_diag_direct_confirm',
    '运行 DIRECT 拨号诊断？',
    '仅当当前策略链已选择 DIRECT 时才会执行。它会在设备本机读取运行端口与控制器鉴权所需字段，但不会显示或上传订阅、密钥、UUID、节点/服务器地址；随后通过 Mihomo mixed-port 访问固定公共地址 1.1.1.1，并读取本机路由、核心进程状态及最多数秒的 Clash.Core 日志。不会修改配置、路由或防火墙规则。',
    '开始诊断',
   );
   if (!confirmed || running) return;

   running = true;
   runButton && (runButton.disabled = true);
   directButton && (directButton.disabled = true);
   loadButton && (loadButton.disabled = true);
   const existing = output?.value ? `${output.value}\n\n` : '';
   setOutput(`${existing}【DIRECT 拨号诊断】\n正在确认当前策略并采集只读诊断信息…`);
   try {
    if (!latestRuntime) {
     const configResult = await runRootChecked('test -s /data/clash/Proxy/config.yaml && cat /data/clash/Proxy/config.yaml', 15000);
     if (!configResult.success) throw new Error(configResult.content || '无法读取当前配置');
     const configText = String(configResult.content || '');
     const runtime = readSettingsFromConfig(configText, loadPluginSettings());
     latestRuntime = {
      mixedPort: Number(findTopLevelValue(configText, 'mixed-port') || findTopLevelValue(configText, 'port') || 7890),
      controllerPort: Number(runtime.controllerPort || 7788),
      controllerSecret: runtime.controllerSecret || '',
     };
    }
    const controllerHeaders = latestRuntime.controllerSecret
     ? `--header ${shellQuote(`Authorization: Bearer ${latestRuntime.controllerSecret}`)}`
     : '';
    const controllerUrl = `http://127.0.0.1:${latestRuntime.controllerPort}/proxies`;
    const controllerResult = await runDeviceCurl(`${controllerHeaders} --connect-timeout 5 --max-time 10 ${shellQuote(controllerUrl)}`, 15000, false);
    let chain = { steps: [], leaf: '' };
    if (controllerResult.success) {
     try { chain = selectedChain(JSON.parse(controllerResult.content)); } catch (_) { /* no controller data */ }
    }
    const isDirect = chain.steps.some((step) => String(step.now || '').toUpperCase() === 'DIRECT')
     || String(chain.leaf || '').toUpperCase() === 'DIRECT';
    if (!isDirect) {
     setOutput(`${existing}【DIRECT 拨号诊断】\n未执行：当前策略链并未选择 DIRECT。\n\n【当前策略链】\n${chain.steps.length ? chain.steps.map((step) => `${step.name} → ${step.now}`).join('\n') : '无法读取策略链'}\n\n请先在面板中把 PROXY 切到 DIRECT，再点击本按钮。`);
     return;
    }

    const result = await runRootChecked(`
    curl_bin=/data/data/com.minikano.f50_sms/files/curl
    if [ ! -x "$curl_bin" ]; then curl_bin=$(command -v curl 2>/dev/null || true); fi
    [ -n "$curl_bin" ] && [ -x "$curl_bin" ] || { echo 'curl unavailable'; exit 40; }
    work=/data/local/tmp/ufi-direct-diag-$$
    log_file="$work.log"
    rm -f "$log_file"
    core_pid=$(pgrep -f '[C]lash.Core' 2>/dev/null | head -n 1 || true)
    echo 'ROUTE_NORMAL:'
    ip route get 1.1.1.1 2>&1 || true
    echo 'ROUTE_MARK_1:'
    ip route get 1.1.1.1 mark 1 2>&1 || true
    echo 'CORE:'
    if [ -n "$core_pid" ]; then
      echo "pid=$core_pid"
      grep -E '^(Name|Uid|Gid):' "/proc/$core_pid/status" 2>/dev/null || true
      readlink "/proc/$core_pid/ns/net" 2>/dev/null || true
    else
      echo 'no Clash.Core process found'
    fi
    logcat -v brief -s Clash.Core:* '*:S' > "$log_file" 2>&1 &
    log_pid=$!
    sleep 1
    probe_exit=0
    "$curl_bin" -k --proxy ${shellQuote(`http://127.0.0.1:${latestRuntime.mixedPort}`)} --connect-timeout 5 --max-time 12 --output /dev/null --write-out 'DIRECT_PROBE HTTP=%{http_code} TLS=%{time_appconnect} TOTAL=%{time_total}\\n' ${shellQuote('https://1.1.1.1/cdn-cgi/trace')} || probe_exit=$?
    sleep 1
    kill "$log_pid" 2>/dev/null || true
    wait "$log_pid" 2>/dev/null || true
    echo "DIRECT_PROBE_EXIT=$probe_exit"
    echo 'MIHOMO_LOGS:'
    grep -iE '1\\.1\\.1\\.1|direct|timeout|dial|connect|network|route' "$log_file" 2>/dev/null | tail -n 40 || true
    [ -s "$log_file" ] || echo 'no core logs captured'
    rm -f "$log_file"
    `, 35000);
    const diagnostic = result.success ? String(result.content || '').trim() : `失败：${String(result.content || '诊断命令失败').trim()}`;
    setOutput(`${existing}【DIRECT 拨号诊断】\n【当前策略链】\n${chain.steps.map((step) => `${step.name} → ${step.now}`).join('\n')}\n\n${diagnostic}\n\n【如何看结果】\nROUTE_MARK_1 显示 local/lo 是 TProxy 标记流量的正常表现；关键是 DIRECT_PROBE 与 MIHOMO_LOGS。请复制完整结果发回，不要额外粘贴配置或节点信息。`);
   } catch (error) {
    setOutput(`${existing}【DIRECT 拨号诊断】\n失败：${String(error?.message || error)}`);
   } finally {
    running = false;
    runButton && (runButton.disabled = false);
    directButton && (directButton.disabled = false);
    loadButton && (loadButton.disabled = false);
   }
  };

  const runLoadTest = async () => {
   const confirmed = await askConfirm(
    'ufi_chain_diag_load_confirm',
    '运行负载抖动测试？',
    '测试会在约 12 秒内通过当前 Mihomo mixed-port 下载最多约 12MB 公共测试数据，并同时重复访问公共连通性地址记录 HTTPS 延迟。不会修改配置、切换节点或上传本地数据。',
    '开始测试',
   );
   if (!confirmed || running) return;
   if (!latestRuntime) await runBasicTest();
   if (!latestRuntime) return;
   running = true;
   runButton && (runButton.disabled = true);
   directButton && (directButton.disabled = true);
   loadButton && (loadButton.disabled = true);
   const existing = output?.value ? `${output.value}\n\n` : '';
   setOutput(`${existing}【负载抖动测试】\n正在下载公共测试数据，并采样代理 HTTPS 延迟…`);
   try {
    const result = await runRootChecked(`
    curl_bin=/data/data/com.minikano.f50_sms/files/curl
    if [ ! -x "$curl_bin" ]; then curl_bin=$(command -v curl 2>/dev/null || true); fi
    [ -n "$curl_bin" ] && [ -x "$curl_bin" ] || { echo "curl 不可用"; exit 40; }
    work=/data/local/tmp/ufi-chain-diag-$$
    probe_log="$work.probe"
    load_log="$work.load"
    rm -f "$probe_log" "$load_log"
    proxy_url=${shellQuote(`http://127.0.0.1:${latestRuntime.mixedPort}`)}
    probe_url=${shellQuote('https://www.gstatic.com/generate_204')}
    load_url=''
    for candidate in \
      'https://speed.cloudflare.com/__down?bytes=12000000' \
      'https://cachefly.cachefly.net/10mb.test' \
      'https://proof.ovh.net/files/10Mb.dat'; do
      if "$curl_bin" --fail --silent --show-error --location --proxy "$proxy_url" --range 0-1023 --connect-timeout 6 --max-time 10 --output /dev/null "$candidate" >/dev/null 2>&1; then
        load_url="$candidate"
        break
      fi
    done
    [ -n "$load_url" ] || { echo 'LOAD: 没有可用的公共下载源（未开始负载测试）'; exit 42; }
    "$curl_bin" --fail --silent --show-error --location --proxy "$proxy_url" --range 0-11999999 --connect-timeout 8 --max-time 12 --output /dev/null --write-out "SOURCE=$load_url LOAD_SPEED=%{speed_download} TOTAL=%{time_total}\\n" "$load_url" > "$load_log" 2>&1 &
    load_pid=$!
    i=1
    while [ "$i" -le 10 ]; do
      "$curl_bin" --fail --silent --show-error --location --proxy "$proxy_url" --connect-timeout 5 --max-time 8 --output /dev/null --write-out "PROBE_$i HTTP=%{http_code} DNS=%{time_namelookup} TCP=%{time_connect} TLS=%{time_appconnect} TOTAL=%{time_total}\\n" "$probe_url?ufi_chain_load=$i" >> "$probe_log" 2>&1 || true
      i=$((i + 1))
      sleep 1
    done
    wait "$load_pid" || true
    echo 'LOAD:'
    cat "$load_log"
    echo 'HTTPS_PROBES:'
    cat "$probe_log"
    rm -f "$probe_log" "$load_log"
    `, 90000);
    const current = output?.value || '';
    setOutput(`${current}\n${result.success ? String(result.content || '').trim() : `失败：${String(result.content || '负载测试失败').trim()}`}\n提示：负载期间 HTTPS_PROBES 的 TOTAL 明显升高、波动变大或超时，才说明代理路径或移动侧队列可能存在拥塞；下载源返回拒绝或所有备用源不可用时，不作性能结论。`);
   } finally {
   running = false;
   runButton && (runButton.disabled = false);
   directButton && (directButton.disabled = false);
   loadButton && (loadButton.disabled = false);
   }
  };

  const requestBasicTest = async () => {
   const confirmed = await askConfirm(
    'ufi_chain_diag_basic_confirm',
    '开始基础测试？',
    '将向 Google 连通性地址发起最多 3 次普通请求：一次 U30 本机直出、一次明确经过 Mihomo、一次来自当前浏览器/热点客户端。不会上传配置或显示出口 IP，但目标站会看到相应请求的来源 IP。',
    '开始测试',
   );
   if (confirmed) await runBasicTest();
  };

  copyButton && (copyButton.onclick = async () => {
   try {
    await navigator.clipboard.writeText(output?.value || '');
    createToast('测试结果已复制', 'green');
   } catch (_) {
    output?.select();
    document.execCommand('copy');
    createToast('测试结果已复制', 'green');
   }
  });
  runButton && (runButton.onclick = requestBasicTest);
  directButton && (directButton.onclick = runDirectDialDiagnostic);
  loadButton && (loadButton.onclick = runLoadTest);
  closeButton && (closeButton.onclick = close);
  setOutput('点击“基础测试”开始。测试结果仅保留在当前浏览器；需要时可手动复制。');
 };

 const chainDiagBtn = document.createElement('button');
 chainDiagBtn.classList.add('btn');
 chainDiagBtn.textContent = '🔍 全链路测试';
 chainDiagBtn.onclick = () => showChainDiagnosticDialog();

 const pluginUpdateBtn = document.createElement('button');
 pluginUpdateBtn.classList.add('btn');
 pluginUpdateBtn.textContent = '在线更新已暂停';
 pluginUpdateBtn.title = '为保护已有插件集合，请使用“插件功能”同名覆盖导入固定安装包。';
 // Pure-JS SHA-256 (works over plain HTTP LAN pages where crypto.subtle is unavailable)
 const sha256Hex = (str) => {
  const bytes = new TextEncoder().encode(str);
  const K = [
   0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
   0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
   0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
   0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
   0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
   0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
   0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
   0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));
  const l = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, l >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(l / 0x100000000), false);
  let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
   for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4, false);
   for (let t = 16; t < 64; t++) {
    const s0 = rotr(7, W[t-15]) ^ rotr(18, W[t-15]) ^ (W[t-15] >>> 3);
    const s1 = rotr(17, W[t-2]) ^ rotr(19, W[t-2]) ^ (W[t-2] >>> 10);
    W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
   }
   let [a,b,c,d,e,f,g,h] = H;
   for (let t = 0; t < 64; t++) {
    const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
    const ch = (e & f) ^ ((~e) & g);
    const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
    const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
   }
   H = [a,b,c,d,e,f,g,h].map((v, idx) => (H[idx] + v) >>> 0);
  }
  return H.map((v) => v.toString(16).padStart(8, '0')).join('');
 };

 const fetchViaUfiProxy = async (url) => {
  const candidates = [`/api/proxy/--${url}`, url];
  let lastErr = null;
  for (const u of candidates) {
   try {
    const r = await fetch(u, { cache: 'no-store' });
    if (r.ok) return await r.text();
    lastErr = new Error(`HTTP ${r.status}`);
   } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('下载失败');
 };

 pluginUpdateBtn.textContent = '🔄 更新插件';
 pluginUpdateBtn.title = `从 ${PLUGIN_REPO} 检查并原地更新 Clash for UFI (当前 v${PLUGIN_VERSION})`;
 pluginUpdateBtn.onclick = async () => {
  pluginUpdateBtn.disabled = true;
  const origText = pluginUpdateBtn.textContent;
  pluginUpdateBtn.textContent = '检查更新中…';
  try {
   const manifestRaw = await fetchViaUfiProxy(`https://raw.githubusercontent.com/${PLUGIN_REPO}/main/manifest.json`);
   const manifest = JSON.parse(manifestRaw);
   if (!manifest?.version || !manifest?.sha256 || !manifest?.plugin_url) {
    throw new Error('manifest.json 格式无效');
   }
   const ok = await askConfirm(
    'clash_plugin_self_update',
    '原地更新 Clash for UFI',
    `当前版本: v${PLUGIN_VERSION}\n远端版本: v${manifest.version}\n说明: ${manifest.notes || '功能与调试优化'}\n\n将严格校验 SHA-256 并只替换 Clash for UFI 插件块，保留其余插件不动。`,
    manifest.version === PLUGIN_VERSION ? '强制重装' : '立即更新',
    '取消',
   );
   if (!ok) return;
   pluginUpdateBtn.textContent = '下载校验中…';
   const newPluginHtml = await fetchViaUfiProxy(manifest.plugin_url);
   const actualSha = sha256Hex(newPluginHtml);
   if (actualSha !== String(manifest.sha256).toLowerCase()) {
    throw new Error(`SHA-256 校验失败 (${actualSha.slice(0,12)}...)`);
   }
   if (!newPluginHtml.includes('mm_action_box') || !newPluginHtml.includes('Clash.Core')) {
    throw new Error('插件结构哨兵校验失败，已中止写入');
   }
   const headRes = await fetch('/api/get_custom_head', { cache: 'no-store' });
   if (!headRes.ok) throw new Error(`读取插件列表失败 (${headRes.status})`);
   const headJson = await headRes.json();
   const fullText = String(headJson?.text || '');
   const KANO_START = '<!-- ' + '[KANO_PLUGIN_START]';
   const KANO_END = '<!-- ' + '[KANO_PLUGIN_END]';
   const findPluginRange = (src, names) => {
    for (const name of names) {
     const startTag = `${KANO_START} ${name} -->`;
     const endTag = `${KANO_END} ${name} -->`;
     const i = src.indexOf(startTag);
     if (i !== -1) {
      const j = src.indexOf(endTag, i + startTag.length);
      if (j !== -1) return { name, startTag, endTag, start: i, end: j + endTag.length };
     }
    }
    return null;
   };
   const found = findPluginRange(fullText, ['clash-for-ufi.js', 'Clash for UFI', 'Clash for UFI.js']);
   if (!found) throw new Error('未找到 Clash for UFI 插件块，请在插件功能中手动导入');
   try { localStorage.setItem('clash_for_ufi_backup_v1', fullText.slice(found.start, found.end)); } catch (_) {}
   let nextText = fullText.slice(0, found.start) + `${found.startTag}\n${newPluginHtml}\n${found.endTag}` + fullText.slice(found.end);
   const oldConsole = findPluginRange(nextText, ['UFI Proxy Console']);
   if (oldConsole) {
    nextText = nextText.slice(0, oldConsole.start) + nextText.slice(oldConsole.end).replace(/^\s+/, '');
   }
   const hdrs = { 'Content-Type': 'application/json' };
   try { if (typeof common_headers === 'object' && common_headers) Object.assign(hdrs, common_headers); } catch (_) {}
   const saveRes = await fetch('/api/set_custom_head', {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({ text: nextText }),
   });
   const saveJson = await saveRes.json().catch(() => ({}));
   if (!saveRes.ok || saveJson.error) {
    throw new Error(saveJson.error || `保存失败 (${saveRes.status})，请确认已登录高级后台`);
   }
   createToast(`插件已更新至 v${manifest.version}，2 秒后刷新页面生效…`, 'green', 4000);
   setTimeout(() => location.reload(), 1800);
  } catch (err) {
   createToast(`插件更新失败: ${err?.message || err}`, 'red', 6500);
  } finally {
   pluginUpdateBtn.disabled = false;
   pluginUpdateBtn.textContent = origText;
  }
 };

 // ============================================================
 // 组装精简 UI + 折叠维护/Pro Debug 端口面板
 // ============================================================
 const mmBox = document.querySelector('#mm_action_box');
 mmBox.appendChild(uploadCoreInput);

 const advToggleBtn = document.createElement('button');
 advToggleBtn.classList.add('btn');
 advToggleBtn.textContent = '🛠️ 维护与调试 ▾';

 // Main high-frequency toolbar
 mmBox.appendChild(btn_restart);
 mmBox.appendChild(stopBtn);
 mmBox.appendChild(boot_on);
 mmBox.appendChild(subBtn);
 mmBox.appendChild(refreshCurrentSubscriptionBtn);
 mmBox.appendChild(settingsBtn);
 mmBox.appendChild(open);
 mmBox.appendChild(refresh);
 mmBox.appendChild(uploadCore);
 mmBox.appendChild(pluginUpdateBtn);
 mmBox.appendChild(advToggleBtn);

 // Collapsible maintenance + Pro Debug drawer
 const advDrawer = document.createElement('div');
 advDrawer.id = 'mm_adv_drawer';
 advDrawer.style.cssText = 'display:none;width:100%;margin-top:8px;padding:12px;border-radius:10px;background:rgba(15,23,42,.45);border:1px solid rgba(255,255,255,.12);';

 const advBtnRow = document.createElement('div');
 advBtnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;';
 [editBtn, backupBtn, uploadBtn, profilesBtn, showLogBtn, dlCoreBtn, btn_enabled, btn_disabled].forEach((b) => advBtnRow.appendChild(b));

 const debugBox = document.createElement('div');
 debugBox.style.cssText = 'border-top:1px solid rgba(255,255,255,.12);padding-top:10px;font-size:12px;color:#cbd5e1;';
 debugBox.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
   <div><strong>🔧 Pro Debug HTTP 端口 (LAN-Only)</strong> · <span id="mm_dbg_status">检测中…</span></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;">
    <button type="button" class="btn" id="mm_dbg_restart">启动/重启 Debug</button>
    <button type="button" class="btn" id="mm_dbg_stop">停止 Debug</button>
    <button type="button" class="btn" id="mm_dbg_token_btn">查看 Token</button>
    <button type="button" class="btn" id="mm_dbg_curl_btn">复制 curl 示例</button>
   </div>
  </div>
  <div id="mm_dbg_token_row" style="display:none;margin-bottom:6px;word-break:break-all;">Token: <code id="mm_dbg_token_val"></code></div>
  <div style="opacity:.82;line-height:1.5;">接口：<code>GET /v1/overview</code> · <code>/v1/network</code> · <code>/v1/mihomo/summary</code> · <code>/v1/config/meta</code> · <code>/v1/logs</code> · <code>POST /v1/subscription/refresh</code> · <code>/v1/probe/latency</code></div>
 `;
 advDrawer.appendChild(advBtnRow);
 advDrawer.appendChild(debugBox);
 mmBox.appendChild(advDrawer);

 let advOpen = false;
 const refreshDebugStatus = async () => {
  const el = document.getElementById('mm_dbg_status');
  if (!el) return;
  try {
   const r = await runShellWithRoot('/data/clash/Scripts/debug_service.sh status 2>/dev/null || echo "{}"', 6000);
   const d = JSON.parse((r.content || '').trim() || '{}');
   el.textContent = d.running
    ? `🟢 http://${d.lan_ip || '192.168.0.1'}:${d.port || 17789} (PID ${d.pids || '-'})`
    : `🔴 未运行 (192.168.0.1:${d.port || 17789})`;
  } catch (_) {
   el.textContent = '状态未知';
  }
 };

 advToggleBtn.onclick = () => {
  advOpen = !advOpen;
  advDrawer.style.display = advOpen ? 'block' : 'none';
  advToggleBtn.textContent = advOpen ? '🛠️ 维护与调试 ▴' : '🛠️ 维护与调试 ▾';
  if (advOpen) void refreshDebugStatus();
 };

 let dbgTokHideTimer = null;
 const hideDbgToken = () => {
  clearTimeout(dbgTokHideTimer);
  const row = document.getElementById('mm_dbg_token_row');
  const val = document.getElementById('mm_dbg_token_val');
  const btn = document.getElementById('mm_dbg_token_btn');
  if (row) row.style.display = 'none';
  if (val) val.textContent = '';
  if (btn) btn.textContent = '查看 Token';
 };

 debugBox.querySelector('#mm_dbg_restart').onclick = async () => {
  await runRootChecked('/data/clash/Scripts/debug_service.sh restart', 10000);
  await refreshDebugStatus();
  createToast('Debug HTTP 服务已启动/重启', 'green', 3500);
 };
 debugBox.querySelector('#mm_dbg_stop').onclick = async () => {
  await runRootChecked('/data/clash/Scripts/debug_service.sh stop', 10000);
  await refreshDebugStatus();
  createToast('Debug HTTP 服务已停止', 'orange', 3500);
 };
 debugBox.querySelector('#mm_dbg_token_btn').onclick = async () => {
  const row = document.getElementById('mm_dbg_token_row');
  const val = document.getElementById('mm_dbg_token_val');
  const btn = document.getElementById('mm_dbg_token_btn');
  if (row.style.display !== 'none') { hideDbgToken(); return; }
  const res = await runRootChecked('/data/clash/Scripts/debug_service.sh token', 6000);
  if (!res.success || !res.content) { createToast('读取 Token 失败', 'red', 4000); return; }
  val.textContent = res.content.trim();
  row.style.display = 'block';
  btn.textContent = '隐藏 Token';
  dbgTokHideTimer = setTimeout(hideDbgToken, 60000);
 };
 debugBox.querySelector('#mm_dbg_curl_btn').onclick = async () => {
  const ip = (typeof UFI_DATA !== 'undefined' && UFI_DATA.lan_ipaddr) ? UFI_DATA.lan_ipaddr : '192.168.0.1';
  const sample = `curl -H "Authorization: Bearer <TOKEN>" http://${ip}:17789/v1/overview`;
  try {
   await navigator.clipboard.writeText(sample);
   createToast('已复制 curl 调试命令示例', 'green', 3000);
  } catch (_) {
   createToast(sample, 'blue', 6000);
  }
 };

 let colTimer = null;
 let colTimer1 = null;
 collapseGen('#collapse_mm_btn', '#collapse_mm', '#collapse_mm', (e) => {
 checkIsBootUp().then((isBootUp) => {
 if (isBootUp) {
 boot_on.style.background = 'var(--dark-btn-color-active)';
 } else {
 boot_on.style.background = '';
 }
 });
 colTimer && clearTimeout(colTimer);
 colTimer1 && clearTimeout(colTimer1);
 if (e == 'open') {
 colTimer1 = setTimeout(() => {
 refresh.click();
 }, 300);
 } else {
 colTimer = setTimeout(() => {
 document.getElementById('mm_iframe').src = `javascript:;`;
 }, 300);
 }
 });
 await isMMRunning();
 })();
})();
</script>
