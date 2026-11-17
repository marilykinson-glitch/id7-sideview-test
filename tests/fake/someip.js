'use strict';
/**
 * A stand-in for the head unit's someip binding: a Guidance whose dart is a placeholder (a phone guides) and
 * a GuidanceEventList that answers queryContent only when the union is written { type, value } with names.
 */
const dart = { maneuver: { type: 'placeholderElement', value: {} } };
const reply = { GuidanceEventListError: 'NO_ERROR', viewContent: [{ eventsInView: [
    { type: 'intersection', value: { uid: 0, guidingStep: 'X', direction: 'LEFT', formattedDistance: { distance: '120', unit: 'METER', rawDistance: 1 } } }] }] };
module.exports.buildProxy = (cfg) => Promise.resolve({
    init: () => Promise.resolve(),
    subscribe: (o) => { if (o.name === 'conclusiveDart') setTimeout(() => o.onReceive(dart), 50); return Promise.resolve(); },
    getValue: (name) => (name === 'conclusiveDart' ? Promise.resolve(dart) : name === 'guidanceState' ? Promise.resolve('INACTIVE') : Promise.resolve('ANDROID_AUTO')),
    callMethod: (name, args) => {
        const a = args.viewConfigs[0].viewport.startPoint.anchorPoint;
        if (!(a.type === 'standardReferencePoint' && a.value === 'CCP')) return Promise.reject(new Error('cannot serialize union'));
        return Promise.resolve(reply);
    },
});
