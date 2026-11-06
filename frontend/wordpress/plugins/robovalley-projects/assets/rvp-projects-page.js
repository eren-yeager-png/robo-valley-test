/*
 * RoboValley Projects page. No libraries. Loaded only on the Projects page.
 *
 * - The catalogue (public fields) comes from the WordPress REST API (GET, or POST /projects/query for the members' subject filter).
 * - Members-only data (project details, the subject list, subject filtering) comes from the RoboValley app with the visitor's own
 *   session cookie (credentials: 'include'); WordPress is never asked for it from here.
 * - Every piece of text from a response is put on the page with textContent, never innerHTML.
 * - Nothing is kept in localStorage or sessionStorage. The project details exist only inside the open window and are removed
 *   from the DOM when it closes.
 * - If anything about sign-in, cookies, CORS or the app fails, the page fails closed: it shows the sign-in prompt or a "try again
 *   later" message and never any restricted data.
 */
( function () {
	'use strict';

	var cfg = window.RVP_PAGE || {};
	var root = document.getElementById( 'rvp-root' );
	if ( ! root || ! window.fetch ) {
		return;
	}
	root.classList.add( 'rvp-js' );

	var APP = typeof cfg.app === 'string' ? cfg.app : '';
	var reduceMotion = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	var grid = root.querySelector( '#rvp-grid' );
	var statusEl = root.querySelector( '#rvp-status' );
	var emptyEl = root.querySelector( '#rvp-empty' );
	var moreBtn = root.querySelector( '#rvp-more' );
	var chipsEl = root.querySelector( '#rvp-chips' );
	var filtersEl = root.querySelector( '#rvp-filters' );
	var filterOpen = root.querySelector( '#rvp-filter-open' );
	var filterCount = root.querySelector( '#rvp-filter-count' );
	var searchForm = root.querySelector( '#rvp-hero-search' );
	var searchInput = root.querySelector( '#rvp-q' );

	var state = {
		view: root.getAttribute( 'data-view' ) || 'all',
		q: '',
		technology: [],
		education: [],
		difficulty: [],
		subjects: [],
		subjectIds: null,
		page: 1,
		perPage: parseInt( root.getAttribute( 'data-per-page' ), 10 ) || 12,
		total: parseInt( root.getAttribute( 'data-total' ), 10 ) || 0,
		totalPages: 1
	};
	state.totalPages = Math.max( 1, Math.ceil( state.total / state.perPage ) );
	var member = false;
	var subjectLabels = {};
	var seq = 0;
	var controller = null;

	/* ---------- small helpers ---------- */
	function el( tag, cls, text ) {
		var n = document.createElement( tag );
		if ( cls ) { n.className = cls; }
		if ( text !== undefined && text !== null ) { n.textContent = text; }
		return n;
	}
	function isHttpUrl( v ) {
		try { var u = new URL( v, location.href ); return u.protocol === 'http:' || u.protocol === 'https:'; } catch ( e ) { return false; }
	}
	function plural( n, one, many ) { return n + ' ' + ( n === 1 ? one : many ); }
	function labelFor( group, slug ) {
		var input = root.querySelector( 'input[name="' + group + '"][value="' + slug.replace( /"/g, '' ) + '"]' );
		var span = input && input.parentNode && input.parentNode.lastElementChild;
		return span ? span.textContent : slug;
	}

	/** Address in the app (sign in / sign up), with a returnTo that brings the visitor back to this project (or, with no project, to this page). The app validates it. */
	function authUrl( path, projectId ) {
		if ( ! APP ) { return ''; }
		var back;
		try {
			var u = new URL( cfg.pageUrl || location.href, location.href );
			u.search = '';
			if ( projectId ) { u.searchParams.set( 'project', String( projectId ) ); }
			u.hash = '';
			back = u.href;
		} catch ( e ) { return APP + path; }
		return APP + path + '?returnTo=' + encodeURIComponent( back );
	}

	/* ---------- cards ---------- */
	function imageEl( img, cls ) {
		if ( ! img || ! isHttpUrl( img.url ) ) { return null; }
		var i = document.createElement( 'img' );
		i.className = cls;
		i.src = img.url;
		if ( typeof img.srcset === 'string' && img.srcset.split( ',' ).every( function ( c ) { return isHttpUrl( c.trim().split( /\s+/ )[ 0 ] ); } ) ) {
			i.srcset = img.srcset;
			i.sizes = '(max-width: 700px) 92vw, 360px';
		}
		i.width = img.width | 0;
		i.height = img.height | 0;
		i.alt = typeof img.alt === 'string' ? img.alt : '';
		i.loading = 'lazy';
		i.decoding = 'async';
		return i;
	}
	function placeholder() {
		var ns = 'http://www.w3.org/2000/svg';
		var svg = document.createElementNS( ns, 'svg' );
		svg.setAttribute( 'class', 'rvp-card-ph' );
		svg.setAttribute( 'viewBox', '0 0 120 80' );
		svg.setAttribute( 'aria-hidden', 'true' );
		var r = document.createElementNS( ns, 'rect' );
		r.setAttribute( 'width', '120' ); r.setAttribute( 'height', '80' ); r.setAttribute( 'fill', '#e3ede7' );
		svg.appendChild( r );
		return svg;
	}
	function cardEl( p ) {
		var card = el( 'article', 'rvp-card' );
		card.setAttribute( 'data-id', String( p.id ) );
		var media = el( 'div', 'rvp-card-media' );
		media.appendChild( imageEl( p.thumbnail, 'rvp-card-img' ) || placeholder() );
		var body = el( 'div', 'rvp-card-body' );
		var tags = el( 'div', 'rvp-card-tags' );
		( p.technology || [] ).forEach( function ( t ) { tags.appendChild( el( 'span', 'rvp-chip rvp-chip-tech', t.name ) ); } );
		if ( p.difficulty ) {
			tags.appendChild( el( 'span', 'rvp-diff rvp-diff-' + String( p.difficulty.slug ).replace( /[^a-z-]/g, '' ), p.difficulty.label ) );
		}
		body.appendChild( tags );
		body.appendChild( el( 'h3', 'rvp-card-title', p.title ) );
		if ( p.short_description ) { body.appendChild( el( 'p', 'rvp-card-desc', p.short_description ) ); }
		if ( p.education && p.education.length ) {
			var ul = el( 'ul', 'rvp-levels' );
			ul.setAttribute( 'aria-label', 'Education levels' );
			p.education.forEach( function ( e ) { ul.appendChild( el( 'li', '', e.name ) ); } );
			body.appendChild( ul );
		}
		var a = el( 'a', 'rvp-btn rvp-btn-primary', 'View Project' );
		a.setAttribute( 'data-rvp-view', String( p.id ) );
		a.href = authUrl( '/login', p.id ) || '#';
		a.appendChild( el( 'span', 'rvp-sr', ' ' + p.title ) );
		body.appendChild( a );
		card.appendChild( media );
		card.appendChild( body );
		return card;
	}

	/* ---------- loading the catalogue ---------- */
	function setStatus( text ) { statusEl.textContent = text || ''; }

	function filterBody( page, ids ) {
		var b = { view: state.view, page: page, per_page: state.perPage };
		if ( state.q ) { b.search = state.q; }
		[ 'technology', 'education', 'difficulty' ].forEach( function ( k ) { if ( state[ k ].length ) { b[ k ] = state[ k ].slice(); } } );
		if ( ids ) { b.include = ids; }
		return b;
	}
	function getUrl( page ) {
		var b = filterBody( page, null );
		var q = [];
		Object.keys( b ).forEach( function ( k ) {
			q.push( encodeURIComponent( k ) + '=' + encodeURIComponent( Array.isArray( b[ k ] ) ? b[ k ].join( ',' ) : b[ k ] ) );
		} );
		return cfg.catalogue + ( cfg.catalogue.indexOf( '?' ) === -1 ? '?' : '&' ) + q.join( '&' );
	}

	function fetchCatalogue( page, ids ) {
		if ( controller ) { controller.abort(); }
		controller = new AbortController();
		var opts = { signal: controller.signal, headers: { Accept: 'application/json' } };
		if ( ids ) {
			opts.method = 'POST';
			opts.headers[ 'Content-Type' ] = 'application/json';
			opts.body = JSON.stringify( filterBody( page, ids ) );
			opts.cache = 'no-store';
			return fetch( cfg.query, opts );
		}
		return fetch( getUrl( page ), opts );
	}

	function showItems( items, append ) {
		if ( ! append ) { grid.replaceChildren(); }
		var firstNew = null;
		items.forEach( function ( p ) {
			var c = cardEl( p );
			if ( ! firstNew ) { firstNew = c; }
			grid.appendChild( c );
		} );
		var shown = grid.children.length;
		emptyEl.hidden = shown > 0;
		moreBtn.hidden = state.page >= state.totalPages;
		setStatus( shown ? 'Showing ' + shown + ' of ' + plural( state.total, 'project', 'projects' ) + '.' : '' );
		return firstNew;
	}

	/** Loads page 1 (or the next page when append is true) for the current filters. */
	function load( append ) {
		var mySeq = ++seq;
		var page = append ? state.page + 1 : 1;
		grid.setAttribute( 'aria-busy', 'true' );
		setStatus( 'Loading projects…' );
		var ready = Promise.resolve( state.subjects.length && member ? subjectIds( append ) : null );
		ready.then( function ( ids ) {
			if ( mySeq !== seq ) { return null; }
			if ( ids === false ) { return null; } // a message has already been shown
			return fetchCatalogue( page, ids ).then( function ( res ) {
				if ( mySeq !== seq ) { return null; }
				if ( ! res.ok ) { throw new Error( 'catalogue ' + res.status ); }
				return res.json().then( function ( data ) {
					if ( mySeq !== seq || ! data || ! Array.isArray( data.items ) || ! data.pagination ) { return; }
					state.page = page;
					state.total = data.pagination.total | 0;
					state.totalPages = Math.max( 1, data.pagination.total_pages | 0 );
					var first = showItems( data.items, append );
					if ( append && first ) { var a = first.querySelector( 'a' ); if ( a ) { a.focus( { preventScroll: true } ); } }
				} );
			} );
		} ).catch( function ( e ) {
			if ( mySeq !== seq || ( e && e.name === 'AbortError' ) ) { return; }
			setStatus( 'Projects could not be loaded right now. Please try again.' );
		} ).then( function () {
			if ( mySeq === seq ) { grid.removeAttribute( 'aria-busy' ); }
		} );
	}

	/**
	 * Members' subject filter: asks the app (signed-in members only) for the ids of the projects with the chosen subjects.
	 * Returns the ids, or false when a message was shown instead (not signed in, too many matches, or the app is unavailable).
	 */
	function subjectIds( reuse ) {
		if ( reuse && state.subjectIds ) { return state.subjectIds; }
		return fetch( APP + '/api/projects/subject-filter?subjects=' + encodeURIComponent( state.subjects.join( ',' ) ), { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } } )
			.then( function ( res ) {
				if ( res.status === 401 ) {
					setMember( false );
					state.subjects = []; state.subjectIds = null;
					syncControls(); renderChips();
					setStatus( '' );
					grid.removeAttribute( 'aria-busy' );
					openUnlock( 0, document.getElementById( 'rvp-subject-lock' ) );
					setTimeout( function () { load( false ); }, 0 ); // show the unfiltered list again behind the prompt
					return false;
				}
				if ( ! res.ok ) { throw new Error( 'subject ' + res.status ); }
				return res.json().then( function ( d ) {
					if ( ! d || d.success !== true || ! Array.isArray( d.ids ) ) { throw new Error( 'shape' ); }
					if ( d.truncated ) {
						state.subjectIds = null;
						grid.replaceChildren(); emptyEl.hidden = true; moreBtn.hidden = true;
						setStatus( 'Too many matches, narrow your filters.' );
						grid.removeAttribute( 'aria-busy' );
						return false;
					}
					state.subjectIds = d.ids;
					return d.ids;
				} );
			} )
			.catch( function () {
				state.subjectIds = null;
				grid.replaceChildren(); emptyEl.hidden = true; moreBtn.hidden = true;
				setStatus( 'The subject filter is not available right now. Please try again later.' );
				grid.removeAttribute( 'aria-busy' );
				return false;
			} );
	}

	/* ---------- filter controls, chips ---------- */
	function readChecks( group ) {
		return Array.prototype.map.call( root.querySelectorAll( 'input[name="' + group + '"]:checked' ), function ( i ) { return i.value; } );
	}
	function syncControls() {
		[ 'technology', 'education', 'difficulty', 'subject' ].forEach( function ( g ) {
			var list = g === 'subject' ? state.subjects : state[ g ];
			Array.prototype.forEach.call( root.querySelectorAll( 'input[name="' + g + '"]' ), function ( i ) { i.checked = list.indexOf( i.value ) !== -1; } );
		} );
		Array.prototype.forEach.call( root.querySelectorAll( '.rvp-tab' ), function ( t ) {
			var on = t.getAttribute( 'data-view' ) === state.view;
			t.setAttribute( 'aria-selected', on ? 'true' : 'false' );
			t.tabIndex = on ? 0 : -1;
		} );
		Array.prototype.forEach.call( root.querySelectorAll( '.rvp-tile' ), function ( t ) {
			t.setAttribute( 'aria-pressed', state.technology.length === 1 && state.technology[ 0 ] === t.getAttribute( 'data-tech' ) ? 'true' : 'false' );
		} );
		searchInput.value = state.q;
	}
	function activeFilters() {
		var out = [];
		if ( state.q ) { out.push( { group: 'q', value: state.q, label: 'Search: ' + state.q } ); }
		[ [ 'technology', 'Technology' ], [ 'education', 'Level' ], [ 'difficulty', 'Difficulty' ] ].forEach( function ( g ) {
			state[ g[ 0 ] ].forEach( function ( v ) { out.push( { group: g[ 0 ], value: v, label: g[ 1 ] + ': ' + labelFor( g[ 0 ], v ) } ); } );
		} );
		state.subjects.forEach( function ( v ) { out.push( { group: 'subject', value: v, label: 'Subject: ' + ( subjectLabels[ v ] || v ) } ); } );
		return out;
	}
	function renderChips() {
		var list = activeFilters();
		chipsEl.replaceChildren();
		list.forEach( function ( f ) {
			var chip = el( 'span', 'rvp-chip', f.label );
			var x = el( 'button', 'rvp-chip-x', '×' );
			x.type = 'button';
			x.setAttribute( 'aria-label', 'Remove filter ' + f.label );
			x.addEventListener( 'click', function () { removeFilter( f.group, f.value ); } );
			chip.appendChild( x );
			chipsEl.appendChild( chip );
		} );
		if ( list.length > 1 ) {
			var all = el( 'button', 'rvp-chip rvp-chip-clear', 'Clear all' );
			all.type = 'button';
			all.addEventListener( 'click', clearAll );
			chipsEl.appendChild( all );
		}
		filterCount.textContent = String( list.length );
		filterCount.hidden = list.length === 0;
	}
	function changed() {
		state.subjectIds = null;
		syncControls();
		renderChips();
		load( false );
	}
	function removeFilter( group, value ) {
		if ( group === 'q' ) { state.q = ''; }
		else if ( group === 'subject' ) { state.subjects = state.subjects.filter( function ( v ) { return v !== value; } ); }
		else { state[ group ] = state[ group ].filter( function ( v ) { return v !== value; } ); }
		changed();
	}
	function clearAll() {
		state.q = ''; state.technology = []; state.education = []; state.difficulty = []; state.subjects = [];
		changed();
	}

	root.addEventListener( 'change', function ( e ) {
		var t = e.target;
		if ( ! t || t.type !== 'checkbox' ) { return; }
		if ( t.name === 'subject' ) { state.subjects = readChecks( 'subject' ); }
		else if ( state[ t.name ] ) { state[ t.name ] = readChecks( t.name ); }
		else { return; }
		changed();
	} );
	Array.prototype.forEach.call( root.querySelectorAll( '.rvp-tab' ), function ( tab, i, tabs ) {
		tab.addEventListener( 'click', function () { state.view = tab.getAttribute( 'data-view' ); changed(); } );
		tab.addEventListener( 'keydown', function ( e ) {
			var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
			if ( n === null ) { return; }
			e.preventDefault();
			var next = tabs[ ( n + tabs.length ) % tabs.length ];
			next.focus();
			next.click();
		} );
	} );
	function scrollToDiscover() {
		var d = document.getElementById( 'rvp-discover' );
		if ( d ) { d.scrollIntoView( { behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' } ); }
	}
	Array.prototype.forEach.call( root.querySelectorAll( '.rvp-tile' ), function ( tile ) {
		tile.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			var slug = tile.getAttribute( 'data-tech' );
			state.technology = state.technology.length === 1 && state.technology[ 0 ] === slug ? [] : [ slug ];
			changed();
			scrollToDiscover();
		} );
	} );
	searchForm.addEventListener( 'submit', function ( e ) {
		e.preventDefault();
		state.q = searchInput.value.replace( /\s+/g, ' ' ).trim().slice( 0, 100 );
		changed();
		scrollToDiscover();
	} );
	moreBtn.addEventListener( 'click', function () { load( true ); } );
	root.querySelector( '#rvp-empty-clear' ).addEventListener( 'click', clearAll );

	/* ---------- mobile filter drawer ---------- */
	var scrim = null;
	function drawerOpen( open ) {
		filtersEl.classList.toggle( 'rvp-open', open );
		filterOpen.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		if ( open ) {
			scrim = el( 'div', 'rvp-scrim' );
			scrim.addEventListener( 'click', function () { drawerOpen( false ); filterOpen.focus(); } );
			root.appendChild( scrim );
			var first = filtersEl.querySelector( 'input,button' );
			if ( first ) { first.focus(); }
		} else if ( scrim ) { scrim.remove(); scrim = null; }
	}
	filterOpen.addEventListener( 'click', function () { drawerOpen( ! filtersEl.classList.contains( 'rvp-open' ) ); } );
	root.querySelector( '#rvp-drawer-close' ).addEventListener( 'click', function () { drawerOpen( false ); filterOpen.focus(); } );
	root.querySelector( '#rvp-drawer-done' ).addEventListener( 'click', function () { drawerOpen( false ); filterOpen.focus(); scrollToDiscover(); } );
	document.addEventListener( 'keydown', function ( e ) {
		if ( e.key === 'Escape' && filtersEl.classList.contains( 'rvp-open' ) && ! modal ) { drawerOpen( false ); filterOpen.focus(); }
	} );
	if ( window.matchMedia ) {
		window.matchMedia( '(min-width: 761px)' ).addEventListener( 'change', function ( m ) { if ( m.matches ) { drawerOpen( false ); } } );
	}

	/* ---------- windows (sign-in prompt and project details) ---------- */
	var modal = null; // { root, dialog, opener }

	function focusables( c ) {
		return Array.prototype.filter.call( c.querySelectorAll( 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])' ), function ( n ) { return n.offsetParent !== null || n === document.activeElement; } );
	}
	function lockScroll( on ) {
		if ( on ) {
			var gap = window.innerWidth - document.documentElement.clientWidth;
			document.body.classList.add( 'rvp-scroll-locked' );
			if ( gap > 0 ) { document.body.style.paddingRight = gap + 'px'; }
		} else {
			document.body.classList.remove( 'rvp-scroll-locked' );
			document.body.style.paddingRight = '';
		}
	}
	function closeModal() {
		if ( ! modal ) { return; }
		var opener = modal.opener;
		modal.root.remove(); // removes everything inside it, including any project details
		modal = null;
		root.inert = false;
		lockScroll( false );
		document.removeEventListener( 'keydown', onModalKey, true );
		if ( opener && document.contains( opener ) ) { opener.focus(); }
	}
	function onModalKey( e ) {
		if ( ! modal ) { return; }
		if ( e.key === 'Escape' ) { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
		if ( e.key !== 'Tab' ) { return; }
		var f = focusables( modal.dialog );
		if ( ! f.length ) { e.preventDefault(); return; }
		var first = f[ 0 ], last = f[ f.length - 1 ];
		if ( ! modal.dialog.contains( document.activeElement ) ) { e.preventDefault(); first.focus(); }
		else if ( e.shiftKey && document.activeElement === first ) { e.preventDefault(); last.focus(); }
		else if ( ! e.shiftKey && document.activeElement === last ) { e.preventDefault(); first.focus(); }
	}
	/** Opens an empty window and returns its scrolling content area. */
	function openModal( titleText, wide, opener ) {
		var openerNode = opener || ( modal && modal.opener ) || document.activeElement;
		closeModalKeepOpener();
		var wrap = el( 'div', 'rvp-modal-root' );
		wrap.appendChild( el( 'div', 'rvp-modal-scrim' ) );
		var dlg = el( 'div', 'rvp-modal' + ( wide ? ' rvp-modal-wide' : '' ) );
		dlg.setAttribute( 'role', 'dialog' );
		dlg.setAttribute( 'aria-modal', 'true' );
		var titleId = 'rvp-modal-title';
		dlg.setAttribute( 'aria-labelledby', titleId );
		var close = el( 'button', 'rvp-iconbtn rvp-modal-close', '×' );
		close.type = 'button';
		close.setAttribute( 'aria-label', 'Close' );
		close.addEventListener( 'click', closeModal );
		var scroll = el( 'div', 'rvp-modal-scroll' );
		dlg.appendChild( close );
		dlg.appendChild( scroll );
		wrap.appendChild( dlg );
		wrap.firstChild.addEventListener( 'click', closeModal );
		document.body.appendChild( wrap );
		root.inert = true;
		lockScroll( true );
		modal = { root: wrap, dialog: dlg, opener: openerNode, scroll: scroll, close: close, titleId: titleId };
		document.addEventListener( 'keydown', onModalKey, true );
		return modal;
	}
	function closeModalKeepOpener() {
		if ( ! modal ) { return; }
		var keep = modal.opener;
		modal.root.remove();
		modal = null;
		document.removeEventListener( 'keydown', onModalKey, true );
		root.inert = false;
		lockScroll( false );
		return keep;
	}
	function titleEl( text ) {
		var h = el( 'h2', '', text );
		h.id = 'rvp-modal-title';
		h.tabIndex = -1;
		return h;
	}

	function openUnlock( projectId, opener ) {
		var m = openModal( 'Unlock Project Details', false, opener );
		var ico = el( 'div', 'rvp-lock-ico' );
		var ns = 'http://www.w3.org/2000/svg';
		var svg = document.createElementNS( ns, 'svg' );
		svg.setAttribute( 'viewBox', '0 0 16 16' ); svg.setAttribute( 'width', '26' ); svg.setAttribute( 'height', '26' ); svg.setAttribute( 'aria-hidden', 'true' );
		var r = document.createElementNS( ns, 'rect' );
		r.setAttribute( 'x', '3' ); r.setAttribute( 'y', '7' ); r.setAttribute( 'width', '10' ); r.setAttribute( 'height', '7' ); r.setAttribute( 'rx', '2' ); r.setAttribute( 'fill', 'currentColor' );
		var p = document.createElementNS( ns, 'path' );
		p.setAttribute( 'd', 'M5.5 7V5a2.5 2.5 0 015 0v2' ); p.setAttribute( 'fill', 'none' ); p.setAttribute( 'stroke', 'currentColor' ); p.setAttribute( 'stroke-width', '1.6' );
		svg.appendChild( r ); svg.appendChild( p ); ico.appendChild( svg );
		m.scroll.appendChild( ico );
		m.scroll.appendChild( titleEl( 'Unlock Project Details' ) );
		var reg = authUrl( '/join', projectId ), log = authUrl( '/login', projectId );
		if ( ! reg || ! log ) {
			m.scroll.appendChild( el( 'p', '', 'Sign-in is not available right now. Please try again later.' ) );
			var only = el( 'button', 'rvp-btn rvp-btn-ghost', 'Close' ); only.type = 'button'; only.addEventListener( 'click', closeModal );
			m.scroll.appendChild( only );
			m.close.focus();
			return;
		}
		m.scroll.appendChild( el( 'p', '', 'Join RoboValley to explore project information, required components, skills and expected outcomes.' ) );
		var actions = el( 'div', 'rvp-modal-actions' );
		var a1 = el( 'a', 'rvp-btn rvp-btn-primary', 'Register Now' ); a1.href = reg;
		var a2 = el( 'a', 'rvp-btn rvp-btn-ghost', 'Login' ); a2.href = log;
		actions.appendChild( a1 ); actions.appendChild( a2 );
		m.scroll.appendChild( actions );
		a1.focus();
	}

	function messageModal( title, text, opener ) {
		var m = openModal( title, false, opener );
		m.scroll.appendChild( titleEl( title ) );
		m.scroll.appendChild( el( 'p', '', text ) );
		var b = el( 'button', 'rvp-btn rvp-btn-ghost', 'Close' ); b.type = 'button'; b.addEventListener( 'click', closeModal );
		m.scroll.appendChild( b );
		b.focus();
	}

	function list( title, items ) {
		var s = el( 'section', 'rvp-detail-section' );
		s.appendChild( el( 'h3', '', title ) );
		var ul = el( 'ul' );
		items.forEach( function ( t ) { ul.appendChild( el( 'li', '', t ) ); } );
		s.appendChild( ul );
		return s;
	}
	function text( title, value ) {
		var s = el( 'section', 'rvp-detail-section' );
		s.appendChild( el( 'h3', '', title ) );
		s.appendChild( el( 'p', '', value ) );
		return s;
	}
	function names( arr ) { return ( arr || [] ).map( function ( t ) { return t.name; } ); }

	function renderDetails( m, p ) {
		m.scroll.replaceChildren();
		m.dialog.removeAttribute( 'aria-busy' );
		m.scroll.style.padding = '0';
		var img = imageEl( p.thumbnail, 'rvp-detail-img' );
		if ( img ) { img.removeAttribute( 'sizes' ); img.loading = 'eager'; m.scroll.appendChild( img ); }
		var body = el( 'div' );
		body.style.padding = '24px 28px 30px';
		var head = el( 'div', 'rvp-detail-head' );
		names( p.technology ).forEach( function ( n ) { head.appendChild( el( 'span', 'rvp-chip rvp-chip-tech', n ) ); } );
		if ( p.difficulty ) { head.appendChild( el( 'span', 'rvp-diff rvp-diff-' + String( p.difficulty.slug ).replace( /[^a-z-]/g, '' ), p.difficulty.label ) ); }
		body.appendChild( head );
		var h = titleEl( p.title );
		h.style.margin = '0 40px 6px 0';
		body.appendChild( h );
		if ( p.education && p.education.length ) {
			var lv = el( 'ul', 'rvp-levels' ); lv.setAttribute( 'aria-label', 'Education levels' );
			names( p.education ).forEach( function ( n ) { lv.appendChild( el( 'li', '', n ) ); } );
			body.appendChild( lv );
		}
		if ( p.overview ) { body.appendChild( text( 'Overview', p.overview ) ); }
		if ( p.subjects && p.subjects.length ) { body.appendChild( list( 'Subjects', names( p.subjects ) ) ); }
		var cols = el( 'div', 'rvp-detail-cols' );
		if ( p.skills && p.skills.length ) { cols.appendChild( list( 'Skills required', p.skills ) ); }
		if ( p.components && p.components.length ) { cols.appendChild( list( 'Components required', p.components ) ); }
		if ( cols.children.length ) { body.appendChild( cols ); }
		if ( p.outcome ) { body.appendChild( text( 'Expected outcome', p.outcome ) ); }
		m.scroll.appendChild( body );
		if ( document.activeElement === m.close || ! m.dialog.contains( document.activeElement ) ) { h.focus(); }
	}

	/** A response is shown only if it is a complete project of the expected shape; anything else fails closed. */
	function validProject( p ) {
		if ( ! p || typeof p !== 'object' || typeof p.id !== 'number' || typeof p.title !== 'string' ) { return false; }
		if ( typeof p.overview !== 'string' || typeof p.outcome !== 'string' || typeof p.short_description !== 'string' ) { return false; }
		return [ 'technology', 'education', 'subjects', 'skills', 'components' ].every( function ( k ) { return Array.isArray( p[ k ] ); } );
	}

	/** Opens the details window. The details are requested from the app only now, and only a 200 shows them. */
	function openProject( id, opener ) {
		if ( ! APP ) { openUnlock( id, opener ); return; }
		var m = openModal( 'Loading project', true, opener );
		m.dialog.setAttribute( 'aria-busy', 'true' );
		var load = el( 'div', 'rvp-loading' );
		load.appendChild( el( 'div', 'rvp-spinner' ) );
		var t = titleEl( 'Loading project…' ); t.className = 'rvp-sr';
		load.appendChild( t );
		load.appendChild( el( 'p', '', 'Loading project details…' ) );
		m.scroll.appendChild( load );
		m.close.focus();
		var mine = m;
		fetch( APP + '/api/projects/' + encodeURIComponent( String( id ) ), { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } } )
			.then( function ( res ) {
				if ( modal !== mine ) { return; } // closed while loading
				if ( res.status === 401 ) { var o = mine.opener; closeModalKeepOpener(); openUnlock( id, o ); return; }
				if ( res.status === 404 ) { var o2 = mine.opener; closeModalKeepOpener(); messageModal( 'Project not available', 'This project is no longer available.', o2 ); return; }
				if ( res.status === 200 ) {
					return res.json().then( function ( d ) {
						if ( modal !== mine ) { return; }
						if ( ! validProject( d && d.success === true ? d.project : null ) ) { throw new Error( 'shape' ); }
						renderDetails( mine, d.project );
					} );
				}
				var o3 = mine.opener; closeModalKeepOpener();
				messageModal( 'Please try again later', 'Project details could not be loaded right now. Please try again in a little while.', o3 );
			} )
			.catch( function ( e ) {
				if ( modal !== mine ) { return; }
				var o4 = mine.opener; closeModalKeepOpener();
				// A network, cookie or CORS failure cannot show details: fail closed with the sign-in prompt.
				if ( e && e.message === 'shape' ) { messageModal( 'Please try again later', 'Project details could not be loaded right now. Please try again in a little while.', o4 ); }
				else { openUnlock( id, o4 ); }
			} );
	}

	// "View Project" (the cards on the page, whether server-rendered or loaded later)
	root.addEventListener( 'click', function ( e ) {
		var a = e.target.closest && e.target.closest( '[data-rvp-view]' );
		if ( ! a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button ) { return; }
		var id = parseInt( a.getAttribute( 'data-rvp-view' ), 10 );
		if ( id > 0 ) { e.preventDefault(); openProject( id, a ); }
	} );

	/* ---------- members: the Subject filter ---------- */
	var lock = root.querySelector( '#rvp-subject-lock' );
	var subjectBox = root.querySelector( '#rvp-subject-options' );
	function setMember( on ) {
		member = on;
		lock.hidden = on && subjectBox.children.length > 0;
		subjectBox.hidden = ! ( on && subjectBox.children.length > 0 );
	}
	lock.addEventListener( 'click', function () { if ( ! member ) { openUnlock( 0, lock ); } } );

	function loadSubjectOptions() {
		return fetch( APP + '/api/projects/subject-options', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } } )
			.then( function ( res ) { return res.ok ? res.json() : null; } )
			.then( function ( d ) {
				if ( ! d || d.success !== true || ! Array.isArray( d.subjects ) || ! d.subjects.length ) { return false; }
				subjectBox.replaceChildren();
				d.subjects.forEach( function ( s ) {
					if ( typeof s.slug !== 'string' || typeof s.name !== 'string' ) { return; }
					subjectLabels[ s.slug ] = s.name;
					var label = el( 'label', 'rvp-check' );
					var input = document.createElement( 'input' ); input.type = 'checkbox'; input.name = 'subject'; input.value = s.slug;
					var box = el( 'span', 'rvp-check-box' );
					label.appendChild( input ); label.appendChild( box ); label.appendChild( el( 'span', '', s.name ) );
					subjectBox.appendChild( label );
				} );
				return subjectBox.children.length > 0;
			} )
			.catch( function () { return false; } );
	}
	if ( APP ) {
		// Who is signed in? (the app's existing /api/auth/me). Any failure leaves the filter locked.
		fetch( APP + '/api/auth/me', { credentials: 'include', cache: 'no-store' } )
			.then( function ( r ) { return r.ok ? r.json() : null; } )
			.then( function ( d ) { return d && d.role ? loadSubjectOptions() : false; } )
			.then( function ( ok ) { if ( ok ) { setMember( true ); } } )
			.catch( function () { /* stays locked */ } );
	}

	/* ---------- start ---------- */
	syncControls();
	renderChips();

	// Coming back after sign-in: ?project=<id> reopens that project, then the parameter is removed from the address.
	try {
		var url = new URL( location.href );
		var wanted = url.searchParams.get( 'project' );
		if ( wanted !== null ) {
			url.searchParams.delete( 'project' );
			history.replaceState( history.state, '', url.pathname + ( url.search ? url.search : '' ) + url.hash );
			if ( /^[1-9][0-9]{0,9}$/.test( wanted ) ) { openProject( parseInt( wanted, 10 ), null ); }
		}
	} catch ( e ) { /* a malformed address just does nothing */ }
}() );
