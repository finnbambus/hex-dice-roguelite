import { UI } from './ui.js?v=7';

const ui = new UI();
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || undefined;
ui.newGame(seed);
window.__ui = ui; // handy for poking at state from the browser console
