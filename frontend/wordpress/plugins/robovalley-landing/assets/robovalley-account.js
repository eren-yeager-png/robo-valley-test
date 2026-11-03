/* RoboValley: header account area. Driven by the RoboValley API (GET /api/auth/me, which returns only {role, firstName});
   this is a display choice only, the API enforces every permission.
     - signed out, or no usable name ........ the original "Sign In / Login" link, unchanged
     - signed-in administrator .............. the plain text "Admin" (not a link) and a "Sign out" button
     - any other signed-in user ............. a button with the first name and a dropdown: the links in MENU_ITEMS, then "Sign out"
   Everything is built with createElement + textContent / setAttribute, never innerHTML, so a name can never become markup. */
( function () {
	'use strict';
	var cfg = window.RoboValleyApi || {};
	var api = cfg.base || '';
	var links = document.querySelectorAll( 'a.rv-signin' );
	if ( ! api || ! window.fetch || ! links.length ) {
		return;
	}

	/** An absolute http(s) URL, or the fallback. */
	function safeUrl( value, fallback ) {
		if ( typeof value !== 'string' || ! value ) {
			return fallback;
		}
		try {
			var u = new URL( value, window.location.href );
			return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : fallback;
		} catch ( e ) {
			return fallback;
		}
	}

	// Dropdown items: label + URL. The first one is the landing page, taken from the site config (RoboValleyApi.home,
	// printed by the plugin from WordPress's home URL).
	var MENU_ITEMS = [
		{ label: 'Homepage', url: safeUrl( cfg.home, window.location.origin + '/' ) },
		{ label: 'My account', url: safeUrl( api + '/dashboard', api ) }
	];

	var css = document.createElement( 'style' );
	css.textContent =
		'.rv-acct{position:relative;display:inline-block;font:inherit}' +
		'.rv-acct-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 18px;font:inherit;font-weight:700;color:inherit;background:transparent;border:2px solid currentColor;border-radius:999px;cursor:pointer}' +
		'.rv-acct-btn:hover{background:rgba(23,105,79,.1)}' +
		'.rv-acct-btn:focus-visible,.rv-acct-menu a:focus-visible{outline:3px solid rgba(23,105,79,.55);outline-offset:2px}' +
		'.rv-acct-caret{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid currentColor;transition:transform .15s}' +
		'.rv-acct-btn[aria-expanded="true"] .rv-acct-caret{transform:rotate(180deg)}' +
		'.rv-acct-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:99999;min-width:200px;max-width:calc(100vw - 32px);margin:0;padding:6px;list-style:none;background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(18,63,51,.28)}' +
		'.rv-acct-menu[hidden]{display:none}' +
		'.rv-acct-menu a{display:flex;align-items:center;min-height:44px;padding:8px 14px;color:#15302a;text-decoration:none;font-weight:600;border-radius:10px}' +
		'.rv-acct-menu a:hover{background:#e3ede7;color:#123f33}' +
		'.rv-acct-admin{display:inline-flex;align-items:center;min-height:44px;font:inherit;font-weight:700;color:inherit;text-decoration:underline;text-underline-offset:3px}' +
		'.rv-acct-adminwrap{display:inline-flex;align-items:center;gap:14px}' +
		'.rv-acct-out{display:flex;align-items:center;width:100%;min-height:44px;padding:8px 14px;font:inherit;font-weight:600;text-align:left;color:#15302a;background:transparent;border:0;border-radius:10px;cursor:pointer}' +
		'.rv-acct-out:hover{background:#e3ede7;color:#123f33}' +
		'.rv-acct-out:focus-visible{outline:3px solid rgba(23,105,79,.55);outline-offset:2px}' +
		'.rv-acct-adminwrap .rv-acct-out{width:auto;padding:8px 16px;border:2px solid currentColor;border-radius:999px;color:inherit}' +
		'.rv-acct-adminwrap .rv-acct-out:hover{background:rgba(23,105,79,.1);color:inherit}' +
		'@media (max-width:600px){.rv-acct-menu{min-width:180px}}';
	document.head.appendChild( css );

	function nameOf( d ) {
		if ( ! d || ! d.role || typeof d.firstName !== 'string' ) {
			return '';
		}
		return d.firstName.trim().slice( 0, 40 );
	}

	/** Removes what a previous render added and shows the original link again. */
	function reset( a ) {
		var extra = a.nextElementSibling;
		if ( extra && extra.getAttribute( 'data-rv-acct' ) !== null ) {
			if ( extra.rvCleanup ) {
				extra.rvCleanup();
			}
			extra.remove();
		}
		a.hidden = false;
		a.removeAttribute( 'hidden' );
	}

	/** A "Sign out" button: ends the session on the RoboValley API, then asks again who is signed in (the header returns to "Sign In / Login"). */
	function signOutButton() {
		var b = document.createElement( 'button' );
		b.type = 'button';
		b.className = 'rv-acct-out';
		b.textContent = 'Sign out';
		b.addEventListener( 'click', function () {
			b.disabled = true;
			fetch( api + '/api/auth/logout', { method: 'POST', credentials: 'include' } )
				.catch( function () { /* the session cookie expires on its own */ } )
				.then( refresh );
		} );
		return b;
	}

	function renderAdmin( a ) {
		var wrap = document.createElement( 'div' );
		wrap.className = 'rv-acct-adminwrap';
		wrap.setAttribute( 'data-rv-acct', 'admin' );
		// Only reached when /api/auth/me said role === 'admin'. This is a convenience link: /admin/dashboard checks the
		// signed-in user's role on the server again, so anyone else who opens it is turned away.
		var link = document.createElement( 'a' );
		link.className = 'rv-acct-admin';
		link.href = safeUrl( api + '/admin/dashboard', api );
		link.textContent = 'Admin';
		wrap.appendChild( link );
		wrap.appendChild( signOutButton() );
		a.hidden = true;
		a.after( wrap );
	}

	function renderUser( a, name ) {
		var wrap = document.createElement( 'div' );
		wrap.className = 'rv-acct';
		wrap.setAttribute( 'data-rv-acct', 'user' );

		var btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = 'rv-acct-btn';
		btn.setAttribute( 'aria-haspopup', 'true' );
		btn.setAttribute( 'aria-expanded', 'false' );
		var label = document.createElement( 'span' );
		label.textContent = name;
		var caret = document.createElement( 'span' );
		caret.className = 'rv-acct-caret';
		caret.setAttribute( 'aria-hidden', 'true' );
		btn.appendChild( label );
		btn.appendChild( caret );

		var menu = document.createElement( 'ul' );
		menu.className = 'rv-acct-menu';
		menu.hidden = true;
		MENU_ITEMS.forEach( function ( item ) {
			var li = document.createElement( 'li' );
			var link = document.createElement( 'a' );
			link.href = item.url;
			link.textContent = item.label;
			li.appendChild( link );
			menu.appendChild( li );
		} );
		var outLi = document.createElement( 'li' );
		outLi.appendChild( signOutButton() );
		menu.appendChild( outLi );

		function setOpen( open ) {
			menu.hidden = ! open;
			btn.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		}
		btn.addEventListener( 'click', function () { setOpen( menu.hidden ); } );
		function onDocClick( e ) { if ( ! wrap.contains( e.target ) ) { setOpen( false ); } }
		function onKey( e ) {
			if ( e.key === 'Escape' && ! menu.hidden ) {
				setOpen( false );
				btn.focus();
			}
		}
		wrap.addEventListener( 'focusout', function ( e ) {
			if ( e.relatedTarget && ! wrap.contains( e.relatedTarget ) ) { setOpen( false ); }
		} );
		document.addEventListener( 'click', onDocClick );
		document.addEventListener( 'keydown', onKey );
		wrap.rvCleanup = function () {
			document.removeEventListener( 'click', onDocClick );
			document.removeEventListener( 'keydown', onKey );
		};

		wrap.appendChild( btn );
		wrap.appendChild( menu );
		a.hidden = true;
		a.after( wrap );
	}

	function render( d ) {
		var name = nameOf( d );
		Array.prototype.forEach.call( links, function ( a ) {
			reset( a );
			if ( ! name ) {
				return; // signed out (or no usable name): the original link stays
			}
			if ( d.role === 'admin' ) {
				renderAdmin( a );
			} else {
				renderUser( a, name );
			}
		} );
	}

	function refresh() {
		fetch( api + '/api/auth/me', { credentials: 'include', cache: 'no-store' } )
			.then( function ( r ) { return r.ok ? r.json() : null; } )
			.then( render )
			.catch( function () { /* API unreachable: leave the button as it is */ } );
	}

	refresh();
	// Coming back with the browser's Back button (cached page) after signing out or in elsewhere: ask again.
	window.addEventListener( 'pageshow', function ( e ) {
		if ( e.persisted ) {
			refresh();
		}
	} );
}() );
