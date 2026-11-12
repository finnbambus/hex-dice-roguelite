import { UI } from './ui.js?v=46';

const ui = new UI();
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || undefined;
ui.newGame(seed);
// A visitor without a seed in the address gets the title card first; a reload or a shared seed goes straight in.
if (!seed) { ui.dialog = 'title'; ui.render(); }
window.__ui = ui; // handy for poking at state from the browser console
