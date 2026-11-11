// Gateway examples only. Access authentication happens at Cloudflare, never here.

export const GATEWAY_EXAMPLES = {
    work: { label: 'Work application', destination: 'docs.workspace.invalid', outcome: 'Allow', rule: 'Allow approved work applications', description: 'This example destination matches the approved-app policy. Browsing would be allowed.' },
    threat: { label: 'Phishing example', destination: 'phishing-example.invalid', outcome: 'Block', rule: 'Block security threats', description: 'This fictional destination represents a phishing-category match. Gateway would block the request.' },
    personal: { label: 'Unapproved file sharing', destination: 'files.personal-drive.invalid', outcome: 'Block', rule: 'Block unapproved file-sharing applications', description: 'This example policy prevents access to an unapproved file-sharing service.' },
};

export function gatewayDecision(id) {
    if (!Object.hasOwn(GATEWAY_EXAMPLES, id)) throw new Error('Unknown Gateway example');
    return { ...GATEWAY_EXAMPLES[id], simulated: true };
}
