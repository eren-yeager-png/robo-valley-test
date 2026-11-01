/* RoboValley: header account label. For a signed-in ADMINISTRATOR the Sign In button reads "Admin" (no name, no email).
   Everyone else, signed in or not, keeps the existing button unchanged. The role comes from the RoboValley API
   (GET /api/auth/me, which returns only {role}); this is a display choice only, the API enforces every permission. */
( function () {
	'use strict';
	var api = ( window.RoboValleyApi && window.RoboValleyApi.base ) || '';
	var links = document.querySelectorAll( 'a.rv-signin' );
	if ( ! api || ! window.fetch || ! links.length ) {
		return;
	}
	fetch( api + '/api/auth/me', { credentials: 'include', cache: 'no-store' } )
		.then( function ( r ) { return r.ok ? r.json() : null; } )
		.then( function ( d ) {
			if ( ! d || d.role !== 'admin' ) {
				return;
			}
			Array.prototype.forEach.call( links, function ( a ) {
				a.textContent = 'Admin';
				a.setAttribute( 'aria-label', 'Admin' );
			} );
		} )
		.catch( function () { /* API unreachable: leave the button as it is */ } );
}() );
