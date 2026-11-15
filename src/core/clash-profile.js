import { parse, stringify } from 'yaml';

function seconds(value) {
    if (typeof value !== 'string') return value;
    const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
    if (!match) throw new Error('Invalid AnyTLS duration');
    const unit = (match[2] || 's').toLowerCase();
    return Math.ceil(Number(match[1]) * {ms: 0.001, s: 1, m: 60, h: 3600}[unit]);
}

export function normalizeClashNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('No available nodes in subscription');
    const names = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL']);
    return nodes.map((item, index) => {
        if (!item || typeof item !== 'object') throw new Error('Invalid node in subscription');
        const node = {...item};
        const base = String(node.name || ('Node-' + (index + 1)));
        let name = base, suffix = 2;
        while (names.has(name)) name = base + ' (' + suffix++ + ')';
        names.add(name);
        node.name = name;
        if (node.type === 'anytls') {
            for (const key of ['idle-session-check-interval', 'idle-session-timeout']) {
                if (key in node) node[key] = seconds(node[key]);
            }
            if (typeof node['min-idle-session'] === 'string' && /^\d+$/.test(node['min-idle-session'])) {
                node['min-idle-session'] = Number(node['min-idle-session']);
            }
        }
        return node;
    });
}

export function createClashProfile(input) {
    const nodes = normalizeClashNodes(input.proxies);
    const names = nodes.map(p => p.name);
    const used = new Set(names);
    const groupName = base => {
        let name = base;
        while (used.has(name)) name += '-GROUP';
        used.add(name);
        return name;
    };
    const main = groupName('PROXY'), auto = groupName('AUTO');
    const awsNodes = names.filter(name => name.startsWith('AWS-'));
    const aws = awsNodes.length ? groupName('AWS') : null;
    const groups = [
        {name: main, type: 'select', proxies: [auto, ...(aws ? [aws] : []), ...names, 'DIRECT']},
        {name: auto, type: 'url-test', url: 'https://www.gstatic.com/generate_204', interval: 600, tolerance: 100, lazy: true, proxies: names},
    ];
    if (aws) groups.push({name: aws, type: 'select', proxies: awsNodes});
    return {
        mode: 'rule', 'log-level': 'info', ipv6: false,
        proxies: nodes, 'proxy-groups': groups,
        rules: [
            'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
            'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
            'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
            'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
            'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
            'GEOIP,CN,DIRECT', 'MATCH,' + main,
        ],
    };
}

export function prepareClashResponse(response, request) {
    if (!request?.url || response.status >= 300) return response;
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/download/') && !url.pathname.startsWith('/share/')) return response;
    const full = url.searchParams.get('profile') === 'clash';
    const target = url.searchParams.get('target') || url.searchParams.get('platform') || '';
    if (!full && !/^(clash|clashmeta|mihomo)$/i.test(target)) return response;
    const doc = parse(response.body);
    if (!doc || !Array.isArray(doc.proxies)) return response;
    const output = full ? createClashProfile(doc) : {...doc, proxies: normalizeClashNodes(doc.proxies)};
    const headers = {...response.headers, 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'private, no-store'};
    delete headers['content-length'];
    delete headers['Content-Length'];
    if (full) headers['Content-Disposition'] = 'attachment; filename="All-Airports-AWS.yaml"';
    return {...response, body: stringify(output, {lineWidth: 0}), headers};
}
