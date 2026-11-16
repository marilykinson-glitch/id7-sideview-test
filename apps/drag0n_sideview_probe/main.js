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
        let cameras = [];
        let cameraStatus = 'Unavailable';
        let cameraPage = 0;
        const pageSize = 4;
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
                };
                const totalPages = Math.ceil(cameras.length / pageSize);
                const page = cameras.slice(cameraPage * pageSize, (cameraPage + 1) * pageSize);
                const title = totalPages ? 'Camera interfaces ' + (cameraPage + 1) + '/' + totalPages : 'Camera interfaces';
                const cameraRows = ['CAM1', 'CAM2', 'CAM3', 'CAM4'].map((id, index) =>
                    ui.text(id, page[index] || (index === 0 && !totalPages ? cameraStatus : ' ')));
                await Promise.all([
                    ...Object.entries(rows).map(([id, value]) => ui.text(id, value, 0, 'Text2ndCol')),
                    ui.text('CAM_NEXT', title),
                    ...cameraRows,
                ]);
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
            cameras = names.map((name) => name.replace(/^de\.bmw\./, ''));
            cameraStatus = 'No matching names';
            log.info('Camera-related interface names: ' + JSON.stringify(names));
        } catch (error) {
            log.warn('Camera catalog: ' + error.message);
        }

        ui.onClick('CAM_NEXT', () => {
            const totalPages = Math.ceil(cameras.length / pageSize);
            if (totalPages > 1) cameraPage = (cameraPage + 1) % totalPages;
            update();
        });
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
