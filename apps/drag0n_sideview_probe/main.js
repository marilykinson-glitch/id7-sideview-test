'use strict';

const fs = require('fs');
const mgu = require('./kit/mgu');
const { decode, cameraNames } = require('./probe');

mgu.run({
    start(ctx) {
        const { ui, log } = ctx;
        const raw = ['Waiting', 'Waiting'];
        const seen = new Set();
        let direction = 'Waiting';
        let status = 'Connecting';
        let camera = 'Unavailable';
        let render = Promise.resolve();
        let pending = false;

        function update() {
            if (pending) return;
            pending = true;
            render = render.then(async () => {
                pending = false;
                if (!ui.isVisible('MAIN')) return;
                const rows = {
                    SIGNAL: direction,
                    SOURCE: status,
                    RAW1: raw[0],
                    RAW2: raw[1],
                    SEEN: Array.from(seen).join(' / ') || 'None',
                    CAM: camera,
                };
                await Promise.all(Object.entries(rows).map(([id, value]) => ui.text(id, value, 0, 'Text2ndCol')));
            }).catch((error) => log.warn(String(error)));
        }

        function receive(index, value) {
            const event = decode(value);
            raw[index] = event.raw;
            status = 'Receiving';
            if (event.direction) {
                direction = event.direction;
                seen.add(direction);
            }
            update();
        }

        try {
            const catalog = JSON.parse(fs.readFileSync('/etc/oap/someip/someip-interfaces.json', 'utf8'));
            const names = cameraNames(catalog);
            camera = names.length ? names.map((name) => name.split('.').pop()).slice(0, 3).join(', ') : 'No matching names';
            log.info('Camera-related interface names: ' + JSON.stringify(names));
        } catch (error) {
            log.warn('Camera catalog: ' + error.message);
        }

        ui.onVisible((name, visible) => {
            if (name === 'MAIN' && visible) update();
        });
        ctx.signals.watch('de.bmw.body.Light', '1', {
            StatusFunctionsIndicators: (value) => receive(0, value),
            StatusFunctionsIndicators2: (value) => receive(1, value),
        }, log).then((subscription) => {
            if (subscription.error) status = String(subscription.error);
            else if (status === 'Connecting') status = 'Waiting for events';
            update();
        }).catch((error) => {
            status = error.message;
            update();
        });
        update();
    },
});
