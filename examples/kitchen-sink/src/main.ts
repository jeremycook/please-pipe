import { appendNode, h, n } from './h';
import { State, Pipe } from '../../../src/Pipe';
import './style.css'

async function App() {

    const count1 = new State(0);
    setInterval(() => count1.value = (count1.value % 100) + .05, 10);

    const count2 = new State(0);
    setInterval(() => count2.value = (count2.value % 100) + .06, 10);

    const mul = count1.combineWith(count2).map(([c1, c2]) => c1.value * c2.value);

    const time = new State(new Date());
    setInterval(() => time.value = new Date(), 1000);
    const tickTock = time.map(x => x.getSeconds() % 2 === 0);

    async function fetchRemoteDate(): Promise<Date> {
        try {
            const data = await (await fetch('http://worldtimeapi.org/api/timezone/America/Denver')).json();
            return new Date(data.datetime);
        }
        catch (err) {
            console.error('fetchRemoteDate', err);
            return new Date();
        }
    }
    const remoteTime = new State<Date>(await fetchRemoteDate());
    setInterval(async () => remoteTime.value = await fetchRemoteDate(), 10000);

    const fragment = document.createDocumentFragment();
    appendNode(fragment, h('div',
        'Hello ', h('strong', 'Bob'), '! ',
        h('strong', count1.map(v => Math.round(v))), ' x ', h('strong', count2.map(v => Math.round(v))), ' = ', h('strong', mul.map(v => Math.round(v))), '. ',
        h('p', 'Local time is ', h('strong', time.combineWith(tickTock).map(([date, tickTock]) => tickTock.value ? date.value.toLocaleTimeString() : date.value.toLocaleTimeString().replaceAll(':', ' ')))),
        h('p', 'Server time is ', remoteTime.map(rt => rt.toLocaleTimeString())),
        h('p', 'A local promise: ', new Promise<Node>(resolve => setTimeout(() => resolve(n('Hi!')), 2000))),
        h('div', () => {
            const canvas = h('canvas');
            canvas.width = 500;
            canvas.height = 200;
            const ctx = canvas.getContext('2d')!;

            const drawer = count1.combineWith(count2).map(([{ value: c1 }, { value: c2 }]: Pipe<number>[]) => {
                const x1 = (canvas.width * (c2 / 25)) % canvas.width;
                const y1 = canvas.height * ((1 + Math.sin(c1)) / 2);

                const x2 = (25 + (canvas.width * (c1 / 25))) % canvas.width;
                const y2 = canvas.height * ((2 + Math.sin(c2)) / 4);

                return { x1, y1, x2, y2 };
            });

            drawer.subscribe(({ value: { x1, y1, x2, y2 } }) => {
                ctx.fillStyle = "#FFFFFF11";
                ctx.fillRect(x1, 0, 10, canvas.height);

                ctx.fillStyle = "#000000";
                ctx.fillRect(x1, y1, 1, 1);

                ctx.fillStyle = "#CC0000";
                ctx.fillRect(x2, y2, 1, 1);
            })

            canvas.addEventListener('dispose', () => drawer.dispose());

            return canvas;
        }),
    ));

    return fragment;
}

App().then(fragment => document.getElementById('root')?.replaceWith(h('h1', 'Hello World!'), fragment, h('p', 'End')));
