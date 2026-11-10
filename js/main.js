import { UI } from './ui.js?v=3';

const ui = new UI();
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || undefined;
ui.newGame(seed);
window.__ui = ui; // handy for poking at state from the browser console
