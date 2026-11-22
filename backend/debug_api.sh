#!/system/bin/sh
# Clash for UFI — Pro Debug & Control HTTP/1.1 Handler (invoked by socat)
# Security: Binds ONLY 127.0.0.1 & 192.168.0.1:17789; Bearer auth + rate limit;
#           zero arbitrary shell execution; zero secret/subscription URL leakage.

JQ="/data/data/com.minikano.f50_sms/files/jq"
CURL="/data/data/com.minikano.f50_sms/files/curl"
YQ="/data/clash/Tools/yq_linux_arm64"
CLASH_BIN="/data/clash/Proxy/Clash.Core"
CLASH_DIR="/data/clash/Proxy"
CLASH_CFG="/data/clash/Proxy/config.yaml"
SUB_SOURCE="/data/clash/Profiles/current-subscription.source"
SUB_MARKER="/data/clash/Profiles/current-subscription.json"
DEBUG_DIR="/data/clash/debug"
TOKEN_FILE="$DEBUG_DIR/api.token"
AUDIT_LOG="$DEBUG_DIR/audit.log"
FAIL_DIR="$DEBUG_DIR/fail"
LOCK_DIR="$DEBUG_DIR/action.lock"
MIHOMO_API="http://127.0.0.1:7788"

mkdir -p "$DEBUG_DIR" "$FAIL_DIR" 2>/dev/null || true

ALLOWED_ORIGIN=""
send_cors_headers() {
    if [ -n "$ALLOWED_ORIGIN" ]; then
        printf 'Access-Control-Allow-Origin: %s\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nVary: Origin\r\n' "$ALLOWED_ORIGIN"
    fi
}

send_json() {
    local code="$1"
    local reason="$2"
    local body="$3"
    local len
    len=$(printf '%s' "$body" | wc -c | tr -d ' ')
    printf 'HTTP/1.1 %s %s\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n' "$code" "$reason"
    send_cors_headers
    printf 'Content-Length: %s\r\nConnection: close\r\n\r\n%s' "$len" "$body"
}

audit_log() {
    local action="$1"
    local status="$2"
    local detail="$3"
    local ts peer
    ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown")
    peer="${SOCAT_PEERADDR:-local}"
    printf '%s peer=%s action=%s status=%s %s\n' "$ts" "$peer" "$action" "$status" "$detail" >> "$AUDIT_LOG" 2>/dev/null || true
    # Keep audit log compact on 1.4GB device
    if [ -f "$AUDIT_LOG" ] && [ "$(wc -l < "$AUDIT_LOG" 2>/dev/null || echo 0)" -gt 500 ]; then
        tail -n 250 "$AUDIT_LOG" > "$AUDIT_LOG.tmp" 2>/dev/null && mv "$AUDIT_LOG.tmp" "$AUDIT_LOG" 2>/dev/null || true
    fi
}

redact_text() {
    sed -E \
        -e 's#https?://[^[:space:]"'\''<>]+#[REDACTED_URL]#g' \
        -e 's/(secret|password|uuid|token|auth)[[:space:]]*[:=][[:space:]]*[^[:space:],}]+/\1:[REDACTED]/gi'
}

mihomo_secret() {
    "$YQ" e '.secret // ""' "$CLASH_CFG" 2>/dev/null | tr -d '\r'
}

mihomo_get() {
    local ep="$1"
    local sec
    sec=$(mihomo_secret)
    if [ -n "$sec" ]; then
        "$CURL" -fsS --max-time 5 -H "Authorization: Bearer $sec" "${MIHOMO_API}${ep}" 2>/dev/null
    else
        "$CURL" -fsS --max-time 5 "${MIHOMO_API}${ep}" 2>/dev/null
    fi
}

# Read HTTP request line
IFS= read -r req_line || exit 0
req_line=$(printf '%s' "$req_line" | tr -d '\r')
method=$(printf '%s' "$req_line" | awk '{print $1}')
raw_target=$(printf '%s' "$req_line" | awk '{print $2}')
path=$(printf '%s' "$raw_target" | cut -d'?' -f1)
query=$(printf '%s' "$raw_target" | cut -s -d'?' -f2)

auth_header=""
origin_header=""
content_len=0
while IFS= read -r hdr; do
    hdr=$(printf '%s' "$hdr" | tr -d '\r')
    [ -z "$hdr" ] && break
    case "$hdr" in
        [Aa]uthorization:*|[Aa]UTHORIZATION:*)
            auth_header="${hdr#*:}"
            auth_header=$(printf '%s' "$auth_header" | sed 's/^[[:space:]]*//')
            ;;
        [Oo]rigin:*|[Oo]RIGIN:*)
            origin_header="${hdr#*:}"
            origin_header=$(printf '%s' "$origin_header" | sed 's/^[[:space:]]*//')
            ;;
        [Cc]ontent-[Ll]ength:*|[Cc]ONTENT-[Ll]ENGTH:*)
            cl="${hdr#*:}"
            cl=$(printf '%s' "$cl" | tr -dc '0-9')
            [ -n "$cl" ] && content_len="$cl"
            ;;
    esac
done

case "$origin_header" in
    http://192.168.0.1:2333|http://127.0.0.1:2333|http://ufi.ztedevice.com:2333|http://192.168.*:2333)
        ALLOWED_ORIGIN="$origin_header"
        ;;
esac

if [ "$method" = "OPTIONS" ]; then
    printf 'HTTP/1.1 204 No Content\r\n'
    send_cors_headers
    printf 'Content-Length: 0\r\nConnection: close\r\n\r\n'
    exit 0
fi

# Rate-limit check per peer IP
peer="${SOCAT_PEERADDR:-127.0.0.1}"
safe_peer=$(printf '%s' "$peer" | tr -c '0-9A-Za-z._-' '_')
fail_file="$FAIL_DIR/$safe_peer"
now_ts=$(date +%s 2>/dev/null || echo 0)
if [ -f "$fail_file" ]; then
    f_count=$(awk '{print $1}' "$fail_file" 2>/dev/null || echo 0)
    f_ts=$(awk '{print $2}' "$fail_file" 2>/dev/null || echo 0)
    if [ $((now_ts - f_ts)) -lt 60 ] && [ "$f_count" -ge 5 ]; then
        send_json 429 "Too Many Requests" '{"ok":false,"error":"rate limited for 60s"}'
        exit 0
    elif [ $((now_ts - f_ts)) -ge 60 ]; then
        rm -f "$fail_file"
    fi
fi

# Bearer Token Auth
expected_token=""
[ -f "$TOKEN_FILE" ] && expected_token=$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\r\n ')
provided_token=""
case "$auth_header" in
    Bearer\ *|bearer\ *)
        provided_token="${auth_header#* }"
        ;;
esac

if [ -z "$expected_token" ] || [ "$provided_token" != "$expected_token" ]; then
    prev_count=0
    [ -f "$fail_file" ] && prev_count=$(awk '{print $1}' "$fail_file" 2>/dev/null || echo 0)
    printf '%s %s\n' "$((prev_count + 1))" "$now_ts" > "$fail_file"
    audit_log "$method:$path" "401" "auth_failed"
    send_json 401 "Unauthorized" '{"ok":false,"error":"invalid or missing bearer token"}'
    exit 0
fi
rm -f "$fail_file"

req_body=""
if [ "$path" != "/v1/core/upload" ] && [ "$content_len" -gt 0 ] 2>/dev/null; then
    if [ "$content_len" -gt 4096 ]; then
        send_json 413 "Payload Too Large" '{"ok":false,"error":"request body too large"}'
        exit 0
    fi
    req_body=$(dd bs=1 count="$content_len" 2>/dev/null)
fi

# Routing
case "$method $path" in
    "GET /v1/health")
        send_json 200 "OK" '{"ok":true,"service":"clash-for-ufi-debug","version":"2.0.0"}'
        ;;

    "GET /v1/overview")
        clash_pid=$(pgrep -x Clash.Core 2>/dev/null | head -n 1 || true)
        clash_running="false"
        clash_rss_kb=0
        clash_uptime=""
        if [ -n "$clash_pid" ]; then
            clash_running="true"
            clash_rss_kb=$(awk '/VmRSS:/ {print $2}' "/proc/$clash_pid/status" 2>/dev/null || echo 0)
            clash_uptime=$(ps -o etime= -p "$clash_pid" 2>/dev/null | tr -d ' ' || true)
        fi
        clash_ver=$("$CLASH_BIN" -v 2>/dev/null | head -n 1 || echo "unknown")
        cfg_sha=$(sha256sum "$CLASH_CFG" 2>/dev/null | awk '{print $1}' || echo "")
        cfg_mode=$("$YQ" e '.cmfa-plugin.mode // "tproxy"' "$CLASH_CFG" 2>/dev/null | tr -d '\r')
        mem_line=$(free -m | awk '/Mem:/ {printf "%s/%s/%s", $2, $3, $4}')
        swap_line=$(free -m | awk '/Swap:/ {printf "%s/%s", $2, $3}')
        sub_bound="false"
        [ -s "$SUB_SOURCE" ] && sub_bound="true"
        boot_on="false"
        grep -q '/data/clash/Scripts/Clash.Service start' /sdcard/ufi_tools_boot.sh 2>/dev/null && boot_on="true"

        body=$("$JQ" -n \
            --argjson clash_running "$clash_running" \
            --arg clash_pid "$clash_pid" \
            --argjson clash_rss_kb "${clash_rss_kb:-0}" \
            --arg clash_uptime "$clash_uptime" \
            --arg clash_ver "$clash_ver" \
            --arg cfg_sha "$cfg_sha" \
            --arg cfg_mode "$cfg_mode" \
            --arg mem_mb "$mem_line" \
            --arg swap_mb "$swap_line" \
            --argjson sub_bound "$sub_bound" \
            --argjson boot_on "$boot_on" \
            '{ok:true, clash:{running:$clash_running, pid:$clash_pid, rss_kb:$clash_rss_kb, uptime:$clash_uptime, version:$clash_ver, mode:$cfg_mode, config_sha256:$cfg_sha, boot_autostart:$boot_on}, device:{mem_total_used_free_mb:$mem_mb, swap_total_used_mb:$swap_mb}, subscription:{source_bound:$sub_bound}}')
        send_json 200 "OK" "$body"
        ;;

    "GET /v1/network")
        cell_if=$(ip -br addr show sipa_eth8 2>/dev/null || true)
        br_if=$(ip -br addr show br0 2>/dev/null || true)
        ts_if=$(ip -br addr show tailscale0 2>/dev/null || true)
        r6=$(ip -6 route 2>/dev/null | head -n 20 || true)
        ipt4=$(iptables -t mangle -L -v -n 2>/dev/null | head -n 45 || true)
        ipt6=$(ip6tables -t mangle -L -v -n 2>/dev/null | head -n 45 || true)
        body=$("$JQ" -n \
            --arg cell "$cell_if" \
            --arg br0 "$br_if" \
            --arg tailscale "$ts_if" \
            --arg route6 "$r6" \
            --arg ipt4_mangle "$ipt4" \
            --arg ipt6_mangle "$ipt6" \
            '{ok:true, interfaces:{cellular:$cell, lan_br0:$br0, tailscale:$tailscale}, route6:$route6, mangle:{ipv4:$ipt4_mangle, ipv6:$ipt6_mangle}}')
        send_json 200 "OK" "$body"
        ;;

    "GET /v1/config/meta")
        meta_json=$("$YQ" e -o=json '{
            "mode": (.mode // ""),
            "ipv6": (.ipv6 // false),
            "tcp_concurrent": (.["tcp-concurrent"] // false),
            "geodata_loader": (.["geodata-loader"] // ""),
            "tproxy_port": (.["tproxy-port"] // 0),
            "mixed_port": (.["mixed-port"] // 0),
            "external_controller": (.["external-controller"] // ""),
            "tun_enable": (.tun.enable // false),
            "sniffer_enable": (.sniffer.enable // false),
            "dns_enable": (.dns.enable // false),
            "fake_ip_filter_count": ((.dns["fake-ip-filter"] // []) | length),
            "proxy_count": ((.proxies // []) | length),
            "proxies": [(.proxies // [])[] | {"name": .name, "type": .type, "server": .server, "port": .port, "ip_version": (.["ip-version"] // "")}],
            "group_count": ((.["proxy-groups"] // []) | length),
            "groups": [(.["proxy-groups"] // [])[] | {"name": .name, "type": .type, "now": (.now // "")}],
            "rule_count": ((.rules // []) | length),
            "listener_count": ((.listeners // []) | length)
        }' "$CLASH_CFG" 2>/dev/null)
        if [ -z "$meta_json" ]; then
            send_json 500 "Internal Server Error" '{"ok":false,"error":"failed to parse config.yaml"}'
        else
            send_json 200 "OK" "$("$JQ" -n --argjson meta "$meta_json" '{ok:true, config:$meta}')"
        fi
        ;;

    "GET /v1/mihomo/summary")
        proxies_raw=$(mihomo_get "/proxies")
        conns_raw=$(mihomo_get "/connections")
        [ -z "$conns_raw" ] && conns_raw="{}"
        if [ -z "$proxies_raw" ]; then
            send_json 502 "Bad Gateway" '{"ok":false,"error":"mihomo controller 127.0.0.1:7788 unreachable"}'
        else
            body=$("$JQ" -n --argjson p "$proxies_raw" --argjson c "$conns_raw" '{
                ok:true,
                active_connections: (($c.connections // []) | length),
                upload_total: ($c.uploadTotal // 0),
                download_total: ($c.downloadTotal // 0),
                groups: [$p.proxies | to_entries[] | select(.value.all != null) | {name:.key, type:.value.type, now:.value.now, count:(.value.all | length)}],
                leaves: [$p.proxies | to_entries[] | select(.value.all == null and .value.type != "Selector" and .value.type != "URLTest" and .value.type != "Fallback" and .value.type != "LoadBalance" and .value.type != "Direct" and .value.type != "Reject" and .value.type != "Compatible" and .value.type != "Pass") | {name:.key, type:.value.type, alive:.value.alive, delay:((.value.history // [])[-1].delay // null)}]
            }' 2>/dev/null || true)
            if [ -z "$body" ]; then
                send_json 500 "Internal Server Error" '{"ok":false,"error":"failed to summarize mihomo proxies"}'
            else
                send_json 200 "OK" "$body"
            fi
        fi
        ;;

    "GET /v1/logs")
        target="clash"
        lines=100
        for kv in $(printf '%s' "$query" | tr '&' ' '); do
            case "$kv" in
                target=*) target="${kv#target=}" ;;
                lines=*)
                    l=$(printf '%s' "${kv#lines=}" | tr -dc '0-9')
                    [ -n "$l" ] && [ "$l" -le 500 ] && [ "$l" -ge 1 ] && lines="$l"
                    ;;
            esac
        done
        case "$target" in
            clash) log_file="/data/clash/run.logs" ;;
            config_test) log_file="/data/clash/config-test.log" ;;
            audit) log_file="$AUDIT_LOG" ;;
            *)
                send_json 400 "Bad Request" '{"ok":false,"error":"invalid log target (clash|config_test|audit)"}'
                exit 0
                ;;
        esac
        if [ ! -f "$log_file" ]; then
            send_json 200 "OK" "$("$JQ" -n --arg t "$target" '{ok:true, target:$t, lines:[]}')"
        else
            log_text=$(tail -n "$lines" "$log_file" 2>/dev/null | redact_text)
            send_json 200 "OK" "$("$JQ" -n --arg t "$target" --arg txt "$log_text" '{ok:true, target:$t, content:$txt}')"
        fi
        ;;

    "POST /v1/config/check")
        out=$("$CLASH_BIN" -t -d "$CLASH_DIR" -f "$CLASH_CFG" 2>&1)
        rc=$?
        audit_log "config_check" "$rc" ""
        send_json 200 "OK" "$("$JQ" -n --argjson valid "$([ $rc -eq 0 ] && echo true || echo false)" --arg output "$out" '{ok:($valid), valid:$valid, output:$output}')"
        ;;

    "POST /v1/service/restart"|"POST /v1/service/stop"|"POST /v1/service/start"|"POST /v1/service/reload")
        act="${path##*/}"
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            send_json 409 "Conflict" '{"ok":false,"error":"another control action is in progress"}'
            exit 0
        fi
        trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
        case "$act" in
            stop)
                /data/clash/Scripts/Clash.Service stop >/data/clash/debug/last-action.log 2>&1
                rc=$?
                ;;
            start)
                /data/clash/Scripts/Clash.Service start >/data/clash/debug/last-action.log 2>&1
                rc=$?
                ;;
            restart)
                /data/clash/Scripts/Clash.Service stop >/data/clash/debug/last-action.log 2>&1 || true
                sleep 1
                /data/clash/Scripts/Clash.Service start >>/data/clash/debug/last-action.log 2>&1
                rc=$?
                ;;
            reload)
                sec=$(mihomo_secret)
                if [ -n "$sec" ]; then
                    "$CURL" -fsS --max-time 8 -X PUT -H "Authorization: Bearer $sec" -H "Content-Type: application/json" -d '{"path":"/data/clash/Proxy/config.yaml"}' "${MIHOMO_API}/configs?force=true" >/data/clash/debug/last-action.log 2>&1
                else
                    "$CURL" -fsS --max-time 8 -X PUT -H "Content-Type: application/json" -d '{"path":"/data/clash/Proxy/config.yaml"}' "${MIHOMO_API}/configs?force=true" >/data/clash/debug/last-action.log 2>&1
                fi
                rc=$?
                ;;
        esac
        audit_log "service_$act" "$rc" ""
        out=$(tail -n 30 /data/clash/debug/last-action.log 2>/dev/null | redact_text)
        if [ $rc -eq 0 ]; then
            send_json 200 "OK" "$("$JQ" -n --arg a "$act" --arg o "$out" '{ok:true, action:$a, output:$o}')"
        else
            send_json 500 "Internal Server Error" "$("$JQ" -n --arg a "$act" --arg o "$out" '{ok:false, action:$a, output:$o}')"
        fi
        ;;

    "POST /v1/subscription/refresh")
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            send_json 409 "Conflict" '{"ok":false,"error":"another control action is in progress"}'
            exit 0
        fi
        trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
        if [ ! -s "$SUB_SOURCE" ]; then
            audit_log "sub_refresh" "400" "no_source"
            send_json 400 "Bad Request" '{"ok":false,"error":"no bound subscription source in /data/clash/Profiles/current-subscription.source"}'
            exit 0
        fi
        src_count=$( (cat "$SUB_SOURCE"; echo) | tr -s ' \t\r\n' '\n' | grep -Ec '^https?://' || true)
        if [ "$src_count" -ne 1 ]; then
            audit_log "sub_refresh" "400" "ambiguous_source"
            send_json 400 "Bad Request" '{"ok":false,"error":"subscription source must contain exactly 1 URL"}'
            exit 0
        fi
        sub_url=$(tr -d '\r\n ' < "$SUB_SOURCE")
        tmp_dl="$DEBUG_DIR/sub-candidate.yaml"
        tmp_merged="$DEBUG_DIR/sub-merged.yaml"
        bak_cfg="$DEBUG_DIR/config.yaml.pre-refresh.bak"
        rm -f "$tmp_dl" "$tmp_merged"
        if ! "$CURL" -fsSL --max-time 25 -A "clash.meta/v1.19.32" -o "$tmp_dl" "$sub_url"; then
            audit_log "sub_refresh" "502" "download_failed"
            send_json 502 "Bad Gateway" '{"ok":false,"error":"failed to fetch subscription from bound source"}'
            exit 0
        fi
        # Project local UFI device settings (cmfa-plugin, tproxy-port, controller, secret) onto downloaded YAML
        cp "$tmp_dl" "$tmp_merged"
        old_ctrl=$("$YQ" e '.external-controller // "0.0.0.0:7788"' "$CLASH_CFG" 2>/dev/null)
        old_sec=$("$YQ" e '.secret // ""' "$CLASH_CFG" 2>/dev/null)
        old_cmfa_mode=$("$YQ" e '.cmfa-plugin.mode // "tproxy"' "$CLASH_CFG" 2>/dev/null)
        old_tproxy=$("$YQ" e '.tproxy-port // 7893' "$CLASH_CFG" 2>/dev/null)
        "$YQ" e -i ".[\"external-controller\"] = \"$old_ctrl\" | .[\"tproxy-port\"] = $old_tproxy | .cmfa-plugin.mode = \"$old_cmfa_mode\" | .cmfa-plugin.dashboard = \"zashboard\" | .cmfa-plugin.mosdns_enable = false" "$tmp_merged" 2>/dev/null
        if [ -n "$old_sec" ]; then
            SEC_VAL="$old_sec" "$YQ" e -i '.secret = env(SEC_VAL)' "$tmp_merged" 2>/dev/null
        fi
        test_out=$("$CLASH_BIN" -t -d "$CLASH_DIR" -f "$tmp_merged" 2>&1)
        test_rc=$?
        if [ $test_rc -ne 0 ]; then
            rm -f "$tmp_dl" "$tmp_merged"
            audit_log "sub_refresh" "422" "preflight_failed"
            send_json 422 "Unprocessable Entity" "$("$JQ" -n --arg o "$test_out" '{ok:false, error:"preflight failed", output:$o}')"
            exit 0
        fi
        cp "$CLASH_CFG" "$bak_cfg"
        chmod 600 "$tmp_merged"
        mv "$tmp_merged" "$CLASH_CFG"
        rm -f "$tmp_dl"
        new_sha=$(sha256sum "$CLASH_CFG" | awk '{print $1}')
        # Reload Mihomo via API
        sec=$(mihomo_secret)
        reload_ok=0
        if [ -n "$sec" ]; then
            "$CURL" -fsS --max-time 10 -X PUT -H "Authorization: Bearer $sec" -H "Content-Type: application/json" -d "{\"path\":\"$CLASH_CFG\"}" "${MIHOMO_API}/configs?force=true" >/dev/null 2>&1 && reload_ok=1
        else
            "$CURL" -fsS --max-time 10 -X PUT -H "Content-Type: application/json" -d "{\"path\":\"$CLASH_CFG\"}" "${MIHOMO_API}/configs?force=true" >/dev/null 2>&1 && reload_ok=1
        fi
        if [ "$reload_ok" -ne 1 ]; then
            cp "$bak_cfg" "$CLASH_CFG"
            audit_log "sub_refresh" "500" "reload_failed_rolled_back"
            send_json 500 "Internal Server Error" '{"ok":false,"error":"mihomo reload failed; rolled back previous config.yaml"}'
            exit 0
        fi
        now_iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "")
        printf '{"updatedAt":"%s","configSha256":"%s"}\n' "$now_iso" "$new_sha" > "$SUB_MARKER" 2>/dev/null || true
        audit_log "sub_refresh" "0" "sha=$new_sha"
        send_json 200 "OK" "$("$JQ" -n --arg sha "$new_sha" --arg at "$now_iso" '{ok:true, config_sha256:$sha, updated_at:$at}')"
        ;;

    "POST /v1/probe/latency")
        proxies_raw=$(mihomo_get "/proxies")
        if [ -z "$proxies_raw" ]; then
            send_json 502 "Bad Gateway" '{"ok":false,"error":"mihomo controller unreachable"}'
            exit 0
        fi
        leaf_names=$(printf '%s' "$proxies_raw" | "$JQ" -r '.proxies | to_entries[] | select(.value.all == null and .value.type != "Selector" and .value.type != "URLTest" and .value.type != "Fallback" and .value.type != "LoadBalance" and .value.type != "Direct" and .value.type != "Reject" and .value.type != "Compatible" and .value.type != "Pass") | .key')
        sec=$(mihomo_secret)
        results="[]"
        while IFS= read -r pname; do
            [ -z "$pname" ] && continue
            enc=$(printf '%s' "$pname" | "$JQ" -sRr '@uri')
            if [ -n "$sec" ]; then
                res=$("$CURL" -sS --max-time 6 -H "Authorization: Bearer $sec" "${MIHOMO_API}/proxies/${enc}/delay?timeout=5000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204" 2>/dev/null || echo '{"message":"timeout"}')
            else
                res=$("$CURL" -sS --max-time 6 "${MIHOMO_API}/proxies/${enc}/delay?timeout=5000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204" 2>/dev/null || echo '{"message":"timeout"}')
            fi
            results=$(printf '%s' "$results" | "$JQ" --arg n "$pname" --argjson r "$res" '. + [{name:$n, delay:($r.delay // null), error:($r.message // null)}]')
        done <<EOF
$leaf_names
EOF
        audit_log "probe_latency" "0" ""
        send_json 200 "OK" "$("$JQ" -n --argjson res "$results" '{ok:true, results:$res}')"
        ;;

    "POST /v1/mihomo/select")
        group=$(printf '%s' "$req_body" | "$JQ" -r '.group // ""' 2>/dev/null)
        name=$(printf '%s' "$req_body" | "$JQ" -r '.name // ""' 2>/dev/null)
        if [ -z "$group" ] || [ -z "$name" ]; then
            send_json 400 "Bad Request" '{"ok":false,"error":"group and name are required"}'
            exit 0
        fi
        enc_g=$(printf '%s' "$group" | "$JQ" -sRr '@uri')
        sec=$(mihomo_secret)
        payload=$("$JQ" -n --arg n "$name" '{name:$n}')
        if [ -n "$sec" ]; then
            "$CURL" -fsS --max-time 5 -X PUT -H "Authorization: Bearer $sec" -H "Content-Type: application/json" -d "$payload" "${MIHOMO_API}/proxies/${enc_g}" >/dev/null 2>&1
        else
            "$CURL" -fsS --max-time 5 -X PUT -H "Content-Type: application/json" -d "$payload" "${MIHOMO_API}/proxies/${enc_g}" >/dev/null 2>&1
        fi
        rc=$?
        audit_log "mihomo_select" "$rc" "group=$group"
        if [ $rc -eq 0 ]; then
            send_json 200 "OK" '{"ok":true}'
        else
            send_json 400 "Bad Request" '{"ok":false,"error":"failed to select proxy in mihomo"}'
        fi
        ;;

    "POST /v1/core/upload")
        if [ "$content_len" -le 0 ] 2>/dev/null || [ "$content_len" -gt 125829120 ] 2>/dev/null; then
            send_json 400 "Bad Request" '{"ok":false,"error":"invalid Content-Length (1B..120MiB required)"}'
            exit 0
        fi
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            send_json 409 "Conflict" '{"ok":false,"error":"another control action is in progress"}'
            exit 0
        fi
        trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
        up_raw="$CLASH_DIR/Clash.Core.upload"
        up_stg="$CLASH_DIR/Clash.Core.staging"
        up_bak="$CLASH_DIR/Clash.Core.bak"
        rm -f "$up_raw" "$up_stg"
        blocks=$((content_len / 65536))
        rem=$((content_len % 65536))
        {
            [ "$blocks" -gt 0 ] && dd bs=65536 count="$blocks" 2>/dev/null
            [ "$rem" -gt 0 ] && dd bs=1 count="$rem" 2>/dev/null
        } > "$up_raw"
        actual_sz=$(wc -c < "$up_raw" 2>/dev/null | tr -d ' ' || echo 0)
        if [ "$actual_sz" != "$content_len" ]; then
            rm -f "$up_raw"
            audit_log "core_upload" "400" "truncated=$actual_sz/$content_len"
            send_json 400 "Bad Request" '{"ok":false,"error":"incomplete upload stream"}'
            exit 0
        fi
        magic2=$(od -An -tx1 -N2 "$up_raw" 2>/dev/null | tr -d ' \n')
        if [ "$magic2" = "1f8b" ]; then
            if ! gzip -dc "$up_raw" > "$up_stg" 2>/dev/null; then
                rm -f "$up_raw" "$up_stg"
                audit_log "core_upload" "400" "gzip_failed"
                send_json 400 "Bad Request" '{"ok":false,"error":"gzip decompression failed"}'
                exit 0
            fi
            rm -f "$up_raw"
        else
            mv -f "$up_raw" "$up_stg"
        fi
        magic4=$(od -An -tx1 -N4 "$up_stg" 2>/dev/null | tr -d ' \n')
        mach2=$(od -An -tx1 -j 18 -N2 "$up_stg" 2>/dev/null | tr -d ' \n')
        if [ "$magic4" != "7f454c46" ] || [ "$mach2" != "b700" ]; then
            rm -f "$up_stg"
            audit_log "core_upload" "400" "bad_elf=$magic4/$mach2"
            send_json 400 "Bad Request" '{"ok":false,"error":"not an aarch64 ELF binary"}'
            exit 0
        fi
        chmod 755 "$up_stg"
        new_ver=$("$up_stg" -v 2>&1 | head -n 1 || true)
        test_out=$("$up_stg" -t -d "$CLASH_DIR" -f "$CLASH_CFG" 2>&1)
        if [ $? -ne 0 ]; then
            rm -f "$up_stg"
            audit_log "core_upload" "422" "preflight_failed"
            send_json 422 "Unprocessable Entity" "$("$JQ" -n --arg v "$new_ver" --arg o "$test_out" '{ok:false, error:"new core failed config -t check", version:$v, output:$o}')"
            exit 0
        fi
        new_sha=$(sha256sum "$up_stg" | awk '{print $1}')
        /data/clash/Scripts/Clash.Service stop >/data/clash/debug/last-action.log 2>&1 || true
        sleep 1
        [ -f "$CLASH_BIN" ] && cp -p "$CLASH_BIN" "$up_bak"
        mv -f "$up_stg" "$CLASH_BIN"
        chown root:net_raw "$CLASH_BIN" 2>/dev/null || true
        chmod 755 "$CLASH_BIN"
        if ! /data/clash/Scripts/Clash.Service start >>/data/clash/debug/last-action.log 2>&1; then
            [ -f "$up_bak" ] && cp -p "$up_bak" "$CLASH_BIN" && /data/clash/Scripts/Clash.Service start >>/data/clash/debug/last-action.log 2>&1 || true
            audit_log "core_upload" "500" "start_failed_rolled_back"
            send_json 500 "Internal Server Error" '{"ok":false,"error":"new core failed to start; rolled back Clash.Core.bak"}'
            exit 0
        fi
        audit_log "core_upload" "0" "sha=$new_sha"
        send_json 200 "OK" "$("$JQ" -n --arg v "$new_ver" --arg s "$new_sha" '{ok:true, version:$v, sha256:$s}')"
        ;;

    *)
        send_json 404 "Not Found" '{"ok":false,"error":"unknown endpoint"}'
        ;;
esac
