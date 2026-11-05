/* Shared helpers for the three demo widgets. Everything the page shows comes from the embedded demo file (frontend/demo/contributions-demo.json);
   text is only ever set with textContent / createElement, never as HTML. Nothing is sent anywhere and nothing is stored (no fetch, no
   XMLHttpRequest, no localStorage, no cookies, no geolocation): state lives in this page's memory and is gone on reload. */
var RVD = ( function () {
	'use strict';
	var dataEl = document.querySelector( 'script.rvd-data' );
	var DATA = null;
	try {
		DATA = JSON.parse( dataEl.textContent );
	} catch ( e ) {
		DATA = null;
	}
	function h( tag, attrs ) {
		var n = document.createElement( tag );
		if ( attrs ) {
			Object.keys( attrs ).forEach( function ( k ) {
				var v = attrs[ k ];
				if ( v === false || v == null ) { return; }
				if ( k === 'text' ) { n.textContent = v; } else if ( k === 'class' ) { n.className = v; } else { n.setAttribute( k, v === true ? '' : v ); }
			} );
		}
		for ( var i = 2; i < arguments.length; i++ ) {
			var c = arguments[ i ];
			if ( c == null || c === false ) { continue; }
			n.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
		}
		return n;
	}
	function params() {
		var o = {};
		try {
			new URLSearchParams( location.search ).forEach( function ( v, k ) { o[ k ] = v; } );
		} catch ( e ) { /* no params */ }
		return o;
	}
	function url( base, q ) {
		var s = Object.keys( q || {} ).filter( function ( k ) { return q[ k ]; } ).map( function ( k ) { return encodeURIComponent( k ) + '=' + encodeURIComponent( q[ k ] ); } ).join( '&' );
		return base + ( s ? ( base.indexOf( '?' ) < 0 ? '?' : '&' ) + s : '' );
	}
	function chip() {
		return h( 'span', { 'class': 'rvd-chip', text: 'Demo' } );
	}
	function find( list, id ) {
		for ( var i = 0; i < list.length; i++ ) { if ( list[ i ].id === id ) { return list[ i ]; } }
		return null;
	}
	/** The flag. A widget runs only when its root says data-rvd="on" and the data file says "enabled": true. Otherwise it shows one quiet line. */
	function start( rootId, run ) {
		var root = document.getElementById( rootId );
		if ( ! root || root.getAttribute( 'data-ready' ) ) { return; }
		root.setAttribute( 'data-ready', '1' );
		if ( ! DATA || DATA.enabled === false || root.getAttribute( 'data-rvd' ) !== 'on' ) {
			root.textContent = '';
			root.appendChild( h( 'p', { 'class': 'rvd-meta', text: 'This preview is switched off.' } ) );
			return;
		}
		fonts();
		root.textContent = '';
		root.appendChild( h( 'p', { 'class': 'rvd-notice', role: 'note' }, chip(), DATA.notice ) );
		run( root, DATA );
	}
	function fonts() {
		if ( document.getElementById( 'rvd-fonts' ) ) { return; }
		var ref = document.querySelector( 'link[href*="/wp-content/"], script[src*="/wp-content/"]' );
		if ( ! ref ) { return; }
		var l = document.createElement( 'link' );
		l.id = 'rvd-fonts';
		l.rel = 'stylesheet';
		l.href = ( ref.href || ref.src ).split( '/wp-content/' )[ 0 ] + '/wp-content/plugins/robovalley-landing/assets/robovalley-fonts.css';
		document.head.appendChild( l );
	}
	function badge( label ) {
		var cls = 'rvd-badge' + ( label === 'Manufacturer claim' ? ' rvd-badge--claim' : label === 'Independent test' ? ' rvd-badge--test' : '' );
		return h( 'span', { 'class': cls, text: label } );
	}
	/** A neutral picture placeholder (no photo is ever loaded). */
	function photo( label ) {
		var NS = 'http://www.w3.org/2000/svg';
		var svg = document.createElementNS( NS, 'svg' );
		svg.setAttribute( 'viewBox', '0 0 400 300' );
		svg.setAttribute( 'class', 'rvd-photo' );
		svg.setAttribute( 'role', 'img' );
		svg.setAttribute( 'aria-label', 'Sample picture placeholder: ' + label );
		var r = document.createElementNS( NS, 'rect' );
		r.setAttribute( 'width', '400' ); r.setAttribute( 'height', '300' ); r.setAttribute( 'fill', '#dfece4' );
		var p = document.createElementNS( NS, 'path' );
		p.setAttribute( 'd', 'M0 240 L110 150 L190 220 L270 130 L400 250 L400 300 L0 300 Z' );
		p.setAttribute( 'fill', '#b9cfc4' );
		var c = document.createElementNS( NS, 'circle' );
		c.setAttribute( 'cx', '300' ); c.setAttribute( 'cy', '70' ); c.setAttribute( 'r', '28' ); c.setAttribute( 'fill', '#f0cf96' );
		var t = document.createElementNS( NS, 'text' );
		t.setAttribute( 'x', '200' ); t.setAttribute( 'y', '160' ); t.setAttribute( 'text-anchor', 'middle' ); t.setAttribute( 'font-size', '18' ); t.setAttribute( 'fill', '#56675f' );
		t.textContent = '[' + label + ']';
		svg.appendChild( r ); svg.appendChild( p ); svg.appendChild( c ); svg.appendChild( t );
		return svg;
	}
	/* ---------- In-page detail (a drawer): the full demo text, the Demo chip and a Close button ---------- */
	var drawer = null, opener = null;
	function closeDrawer() {
		if ( ! drawer ) { return; }
		drawer.hidden = true;
		if ( opener && opener.focus ) { opener.focus(); }
		opener = null;
	}
	function openDrawer( from, build ) {
		if ( ! drawer ) {
			drawer = h( 'div', { 'class': 'rvd rvd-drawer', hidden: true } );
			document.body.appendChild( drawer );
			drawer.addEventListener( 'click', function ( e ) { if ( e.target === drawer ) { closeDrawer(); } } );
			document.addEventListener( 'keydown', function ( e ) {
				if ( drawer.hidden ) { return; }
				if ( e.key === 'Escape' ) { e.preventDefault(); closeDrawer(); }
				if ( e.key === 'Tab' ) { // keep keyboard focus inside the open drawer
					var f = drawer.querySelectorAll( 'button, a[href], input, select, textarea' );
					if ( ! f.length ) { return; }
					var first = f[ 0 ], last = f[ f.length - 1 ];
					if ( e.shiftKey && document.activeElement === first ) { e.preventDefault(); last.focus(); } else if ( ! e.shiftKey && document.activeElement === last ) { e.preventDefault(); first.focus(); }
				}
			} );
		}
		opener = from || document.activeElement;
		drawer.textContent = '';
		var title = h( 'h2', { id: 'rvd-drawer-title', tabindex: '-1' } );
		var close = h( 'button', { type: 'button', 'class': 'rvd-btn rvd-btn--ghost rvd-btn--small', text: 'Close' } );
		close.addEventListener( 'click', closeDrawer );
		var panel = h( 'div', { 'class': 'rvd-drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rvd-drawer-title' }, h( 'div', { 'class': 'rvd-drawer-top' }, chip(), close ), title );
		build( panel, title );
		drawer.appendChild( panel );
		drawer.hidden = false;
		title.focus();
	}
	/** Make a whole card open its detail on click, Enter or Space. */
	function clickable( node, label, open ) {
		node.classList.add( 'rvd-card--click' );
		node.setAttribute( 'tabindex', '0' );
		node.setAttribute( 'role', 'button' );
		node.setAttribute( 'aria-label', label );
		node.addEventListener( 'click', function ( e ) { if ( ! e.target.closest || ! e.target.closest( 'a, button, select, input' ) ) { open( node ); } } );
		node.addEventListener( 'keydown', function ( e ) { if ( ( e.key === 'Enter' || e.key === ' ' ) && e.target === node ) { e.preventDefault(); open( node ); } } );
	}
	return { DATA: DATA, h: h, params: params, url: url, chip: chip, find: find, start: start, badge: badge, photo: photo, openDrawer: openDrawer, closeDrawer: closeDrawer, clickable: clickable };
}() );
