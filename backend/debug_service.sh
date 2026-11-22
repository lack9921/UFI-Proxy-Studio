#!/system/bin/sh
# Clash for UFI — Debug HTTP Service Manager (port 17789, LAN + loopback only)

SOCAT="/data/data/com.minikano.f50_sms/files/socat"
HANDLER="/data/clash/Scripts/debug_api.sh"
DEBUG_DIR="/data/clash/debug"
TOKEN_FILE="$DEBUG_DIR/api.token"
SERVICE_LOG="$DEBUG_DIR/service.log"
PORT=17789

detect_lan_ip() {
    local ip
    ip=$(ip -4 -o addr show br0 2>/dev/null | awk 'NR==1 {split($4,a,"/"); print a[1]}')
    [ -z "$ip" ] && ip=$(ip -4 -o addr show 2>/dev/null | awk '$2!="lo" && $4 ~ /^192\.168\./ {split($4,a,"/"); print a[1]; exit}')
    [ -z "$ip" ] && ip="192.168.0.1"
    printf '%s' "$ip"
}

ensure_token() {
    mkdir -p "$DEBUG_DIR" 2>/dev/null || true
    chmod 700 "$DEBUG_DIR" 2>/dev/null || true
    if [ ! -s "$TOKEN_FILE" ]; then
        od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n' > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
    fi
}

list_pids() {
    pgrep -f "socat.*TCP-LISTEN:${PORT}," 2>/dev/null || true
}

start_svc() {
    ensure_token
    if [ -n "$(list_pids)" ]; then
        echo "debug_service already running (port $PORT)"
        return 0
    fi
    local lan_ip
    lan_ip=$(detect_lan_ip)
    chmod 700 "$HANDLER" 2>/dev/null || true
    nohup "$SOCAT" "TCP-LISTEN:${PORT},bind=127.0.0.1,reuseaddr,fork" "EXEC:${HANDLER}" >>"$SERVICE_LOG" 2>&1 </dev/null &
    nohup "$SOCAT" "TCP-LISTEN:${PORT},bind=${lan_ip},reuseaddr,fork" "EXEC:${HANDLER}" >>"$SERVICE_LOG" 2>&1 </dev/null &
    sleep 1
    if [ -n "$(list_pids)" ]; then
        echo "debug_service started on 127.0.0.1:${PORT} and ${lan_ip}:${PORT}"
        return 0
    fi
    echo "debug_service failed to start" >&2
    return 1
}

stop_svc() {
    local pids
    pids=$(list_pids)
    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null || true
        sleep 1
        pids=$(list_pids)
        [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    fi
    echo "debug_service stopped"
}

status_svc() {
    local lan_ip pids
    lan_ip=$(detect_lan_ip)
    pids=$(list_pids | tr '\n' ' ' | sed 's/ *$//')
    if [ -n "$pids" ]; then
        printf '{"running":true,"port":%s,"lan_ip":"%s","pids":"%s"}\n' "$PORT" "$lan_ip" "$pids"
    else
        printf '{"running":false,"port":%s,"lan_ip":"%s","pids":""}\n' "$PORT" "$lan_ip"
    fi
}

case "${1:-status}" in
    start) start_svc ;;
    stop) stop_svc ;;
    restart) stop_svc; start_svc ;;
    status) status_svc ;;
    token) ensure_token; cat "$TOKEN_FILE" ;;
    refresh)
        ensure_token
        CURL="/data/data/com.minikano.f50_sms/files/curl"
        tok=$(cat "$TOKEN_FILE" | tr -d '\r\n ')
        start_svc >/dev/null 2>&1 || true
        "$CURL" -fsS --max-time 35 -X POST -H "Authorization: Bearer $tok" "http://127.0.0.1:${PORT}/v1/subscription/refresh"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|token|refresh}" >&2
        exit 1
        ;;
esac
