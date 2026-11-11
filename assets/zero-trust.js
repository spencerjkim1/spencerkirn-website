import { gatewayDecision } from './zero-trust-model.js';

const byId = (id) => document.getElementById(id);
for (const button of document.querySelectorAll('[data-destination]')) {
    button.addEventListener('click', () => {
        const decision = gatewayDecision(button.dataset.destination);
        byId('gateway-decision').textContent = `${decision.outcome} / Simulated`;
        byId('gateway-rule').textContent = decision.rule;
        byId('gateway-description').textContent = decision.description;
        byId('gateway-destination').textContent = decision.destination;
        byId('gateway-result').dataset.outcome = decision.outcome.toLowerCase();
        byId('gateway-result').hidden = false;
        byId('gateway-status').textContent = `${decision.label}: simulated ${decision.outcome.toLowerCase()} decision. No network request was made.`;
        for (const sibling of document.querySelectorAll('[data-destination]')) sibling.setAttribute('aria-pressed', String(sibling === button));
    });
}
