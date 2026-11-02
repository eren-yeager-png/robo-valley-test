/* RoboValley: header account label. For ANY signed-in user (administrators included) the Sign In button shows the user's
   FIRST name. When signed out, or when the API gives no name, the button keeps its original "Sign In / Login" text.
   The data comes from the RoboValley API (GET /api/auth/me, which returns only {role, firstName}); this is a display
   choice only, the API enforces every permission. The name is written with textContent, never as HTML. */
( function () {
	'use strict';
	var api = ( window.RoboValleyApi && window.RoboValleyApi.base ) || '';
	var links = document.querySelectorAll( 'a.rv-signin' );
	if ( ! api || ! window.fetch || ! links.length ) {
		return;
	}

	function nameOf( d ) {
		if ( ! d || ! d.role || typeof d.firstName !== 'string' ) {
			return '';
		}
		return d.firstName.trim().slice( 0, 40 );
	}

	function render( name ) {
		Array.prototype.forEach.call( links, function ( a ) {
			if ( null === a.getAttribute( 'data-rv-signin-text' ) ) {
				a.setAttribute( 'data-rv-signin-text', a.textContent );
			}
			if ( name ) {
				a.textContent = name;
				a.setAttribute( 'aria-label', name );
			} else {
				a.textContent = a.getAttribute( 'data-rv-signin-text' );
				a.removeAttribute( 'aria-label' );
			}
		} );
	}

	function refresh() {
		fetch( api + '/api/auth/me', { credentials: 'include', cache: 'no-store' } )
			.then( function ( r ) { return r.ok ? r.json() : null; } )
			.then( function ( d ) { render( nameOf( d ) ); } )
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
