(function (root, factory) {
    define(["jasmine", "mock", "test-utils"], factory);
} (this, function (jasmine, mock, test_utils) {
    "use strict";
    const $iq = converse.env.$iq;
    const $msg = converse.env.$msg;
    const Strophe = converse.env.Strophe;
    const sizzle = converse.env.sizzle;
    const u = converse.env.utils;

    describe("XEP-0198 Stream Management", function () {

        it("gets enabled with an <enable> stanza and resumed with a <resume> stanza",
            mock.initConverse(
                ['chatBoxesInitialized'],
                { 'auto_login': false,
                  'enable_smacks': true,
                  'show_controlbox_by_default': true,
                  'smacks_max_unacked_stanzas': 2
                },
                async function (done, _converse) {

            const view = _converse.chatboxviews.get('controlbox');
            spyOn(view, 'renderControlBoxPane').and.callThrough();

            _converse.api.user.login('romeo@montague.lit/orchard', 'secret');
            const sent_stanzas = _converse.connection.sent_stanzas;
            let stanza = await u.waitUntil(() =>
                sent_stanzas.filter(s => (s.tagName === 'enable')).pop());

            expect(_converse.session.get('smacks_enabled')).toBe(false);
            expect(Strophe.serialize(stanza)).toEqual('<enable resume="true" xmlns="urn:xmpp:sm:3"/>');

            let result = u.toStanza(`<enabled xmlns="urn:xmpp:sm:3" id="some-long-sm-id" resume="true"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));
            expect(_converse.session.get('smacks_enabled')).toBe(true);

            await u.waitUntil(() => view.renderControlBoxPane.calls.count());

            let IQ_stanzas = _converse.connection.IQ_stanzas;
            await u.waitUntil(() => IQ_stanzas.length === 4);

            let iq = IQ_stanzas[IQ_stanzas.length-1];
            expect(Strophe.serialize(iq)).toBe(
                `<iq id="${iq.getAttribute('id')}" type="get" xmlns="jabber:client"><query xmlns="jabber:iq:roster"/></iq>`);
            await test_utils.waitForRoster(_converse, 'current', 1);
            IQ_stanzas.pop();

            const disco_iq = IQ_stanzas.pop();
            expect(Strophe.serialize(disco_iq)).toBe(
                `<iq from="romeo@montague.lit" id="${disco_iq.getAttribute('id')}" to="romeo@montague.lit" type="get" xmlns="jabber:client">`+
                    `<pubsub xmlns="http://jabber.org/protocol/pubsub"><items node="eu.siacs.conversations.axolotl.devicelist"/></pubsub></iq>`);

            iq = IQ_stanzas.pop();
            expect(Strophe.serialize(iq)).toBe(
                `<iq from="romeo@montague.lit/orchard" id="${iq.getAttribute('id')}" to="romeo@montague.lit" type="get" xmlns="jabber:client">`+
                    `<query xmlns="http://jabber.org/protocol/disco#info"/></iq>`);

            iq = IQ_stanzas.pop();
            expect(Strophe.serialize(iq)).toBe(
                `<iq from="romeo@montague.lit/orchard" id="${iq.getAttribute('id')}" to="montague.lit" type="get" xmlns="jabber:client">`+
                    `<query xmlns="http://jabber.org/protocol/disco#info"/></iq>`);

            expect(sent_stanzas.filter(s => (s.nodeName === 'r')).length).toBe(2);
            expect(_converse.session.get('unacked_stanzas').length).toBe(5);

            // test handling of acks
            let ack = u.toStanza(`<a xmlns="urn:xmpp:sm:3" h="2"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(ack));
            expect(_converse.session.get('unacked_stanzas').length).toBe(3);

            // test handling of ack requests
            let r = u.toStanza(`<r xmlns="urn:xmpp:sm:3"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(r));

            ack = await u.waitUntil(() => sent_stanzas.filter(s => (s.nodeName === 'a')).pop());
            expect(Strophe.serialize(ack)).toBe('<a h="1" xmlns="urn:xmpp:sm:3"/>');


            const disco_result = $iq({
                'type': 'result',
                'from': 'montague.lit',
                'to': 'romeo@montague.lit/orchard',
                'id': disco_iq.getAttribute('id'),
            }).c('query', {'xmlns': 'http://jabber.org/protocol/disco#info'})
                .c('identity', {
                    'category': 'server',
                    'type': 'im'
                }).up()
                .c('feature', {'var': 'http://jabber.org/protocol/disco#info'}).up()
                .c('feature', {'var': 'http://jabber.org/protocol/disco#items'});
            _converse.connection._dataRecv(test_utils.createRequest(disco_result));

            ack = u.toStanza(`<a xmlns="urn:xmpp:sm:3" h="3"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(ack));
            expect(_converse.session.get('unacked_stanzas').length).toBe(2);

            r = u.toStanza(`<r xmlns="urn:xmpp:sm:3"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(r));
            ack = await u.waitUntil(() => sent_stanzas.filter(s => (s.nodeName === 'a' && s.getAttribute('h') === '1')).pop());
            expect(Strophe.serialize(ack)).toBe('<a h="1" xmlns="urn:xmpp:sm:3"/>');

            // test session resumption
            _converse.connection.IQ_stanzas = [];
            IQ_stanzas = _converse.connection.IQ_stanzas;
            await _converse.api.connection.reconnect();
            stanza = await u.waitUntil(() => sent_stanzas.filter(s => (s.tagName === 'resume')).pop());

            expect(Strophe.serialize(stanza)).toEqual('<resume h="2" previd="some-long-sm-id" xmlns="urn:xmpp:sm:3"/>');

            result = u.toStanza(`<resumed xmlns="urn:xmpp:sm:3" h="another-sequence-number" previd="some-long-sm-id"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));

            // Another <enable> stanza doesn't get sent out
            expect(sent_stanzas.filter(s => (s.tagName === 'enable')).length).toBe(1);
            expect(_converse.session.get('smacks_enabled')).toBe(true);

            await u.waitUntil(() => IQ_stanzas.length === 1);

            // Test that unacked stanzas get resent out
            iq = IQ_stanzas.pop();
            expect(Strophe.serialize(iq)).toBe(`<iq id="${iq.getAttribute('id')}" type="get" xmlns="jabber:client"><query xmlns="jabber:iq:roster"/></iq>`);

            expect(IQ_stanzas.filter(iq => sizzle('query[xmlns="jabber:iq:roster"]', iq).pop()).length).toBe(0);

            await _converse.api.waitUntil('statusInitialized');
            done();
        }));


        it("might not resume and the session will then be reset",
            mock.initConverse(
                ['chatBoxesInitialized'],
                { 'auto_login': false,
                  'enable_smacks': true,
                  'show_controlbox_by_default': true,
                  'smacks_max_unacked_stanzas': 2
                },
                async function (done, _converse) {

            _converse.api.user.login('romeo@montague.lit/orchard', 'secret');
            const sent_stanzas = _converse.connection.sent_stanzas;
            let stanza = await u.waitUntil(() => sent_stanzas.filter(s => (s.tagName === 'enable')).pop());
            expect(Strophe.serialize(stanza)).toEqual('<enable resume="true" xmlns="urn:xmpp:sm:3"/>');
            let result = u.toStanza(`<enabled xmlns="urn:xmpp:sm:3" id="some-long-sm-id" resume="true"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));

            await test_utils.waitForRoster(_converse, 'current', 1);

            // test session resumption
            await _converse.api.connection.reconnect();
            stanza = await u.waitUntil(() => sent_stanzas.filter(s => (s.tagName === 'resume')).pop());
            expect(Strophe.serialize(stanza)).toEqual('<resume h="1" previd="some-long-sm-id" xmlns="urn:xmpp:sm:3"/>');

            result = u.toStanza(
                `<failed xmlns="urn:xmpp:sm:3" h="another-sequence-number">`+
                    `<item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>`+
                `</failed>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));

            // Session data gets reset
            expect(_converse.session.get('smacks_enabled')).toBe(false);
            expect(_converse.session.get('num_stanzas_handled')).toBe(0);
            expect(_converse.session.get('num_stanzas_handled_by_server')).toBe(0);
            expect(_converse.session.get('num_stanzas_since_last_ack')).toBe(0);
            expect(_converse.session.get('unacked_stanzas').length).toBe(0);
            expect(_converse.session.get('roster_cached')).toBeFalsy();


            await u.waitUntil(() => sent_stanzas.filter(s => (s.tagName === 'enable')).length === 2);
            stanza = sent_stanzas.filter(s => (s.tagName === 'enable')).pop();
            expect(Strophe.serialize(stanza)).toEqual('<enable resume="true" xmlns="urn:xmpp:sm:3"/>');

            result = u.toStanza(`<enabled xmlns="urn:xmpp:sm:3" id="another-long-sm-id" resume="true"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));
            expect(_converse.session.get('smacks_enabled')).toBe(true);

            // Check that the roster gets fetched
            await test_utils.waitForRoster(_converse, 'current', 1);
            done();
        }));


        it("will handle MUC messages sent during disconnection",
            mock.initConverse(
                ['chatBoxesInitialized'],
                { 'auto_login': false,
                  'enable_smacks': true,
                  'show_controlbox_by_default': true,
                  'blacklisted_plugins': 'converse-mam',
                  'smacks_max_unacked_stanzas': 2
                },
                async function (done, _converse) {


            const key = "converse-test-session/converse.session-romeo@montague.lit-converse.session-romeo@montague.lit";
            sessionStorage.setItem(
                key,
                JSON.stringify({
                    "id": "converse.session-romeo@montague.lit",
                    "jid": "romeo@montague.lit/converse.js-100020907",
                    "bare_jid": "romeo@montague.lit",
                    "resource": "converse.js-100020907",
                    "domain": "montague.lit",
                    "active": false,
                    "smacks_enabled": true,
                    "num_stanzas_handled": 580,
                    "num_stanzas_handled_by_server": 525,
                    "num_stanzas_since_last_ack": 0,
                    "unacked_stanzas": [],
                    "smacks_stream_id": "some-long-sm-id",
                    "push_enabled": ["romeo@montague.lit"],
                    "carbons_enabled": true,
                    "roster_cached": true
                })
            )
            _converse.api.user.login('romeo@montague.lit', 'secret');
            const sent_stanzas = _converse.connection.sent_stanzas;
            const stanza = await u.waitUntil(() => sent_stanzas.filter(s => (s.tagName === 'resume')).pop());
            expect(Strophe.serialize(stanza)).toEqual('<resume h="580" previd="some-long-sm-id" xmlns="urn:xmpp:sm:3"/>');

            const result = u.toStanza(`<resumed xmlns="urn:xmpp:sm:3" h="another-sequence-number" previd="some-long-sm-id"/>`);
            _converse.connection._dataRecv(test_utils.createRequest(result));
            expect(_converse.session.get('smacks_enabled')).toBe(true);

            const muc_jid = 'lounge@montague.lit/some1';
            // A MUC message gets received
            const msg = $msg({
                    from: muc_jid,
                    id: u.getUniqueId(),
                    to: 'romeo@montague.lit',
                    type: 'groupchat'
                }).c('body').t('First message').tree();
            _converse.connection._dataRecv(test_utils.createRequest(msg));
            expect(_converse.session.get('smacks_received_stanzas').length).toBe(1);

            await _converse.api.waitUntil('statusInitialized');

            // Test now that when a MUC gets opened, it checks whether there
            // are SMACKS messages waiting for it.
            await test_utils.openAndEnterChatRoom(_converse, muc_jid, 'romeo');
            await u.waitUntil(() => view.el.querySelectorAll('.chat-msg').length === 1);
            done();
        }));
    });
}));
