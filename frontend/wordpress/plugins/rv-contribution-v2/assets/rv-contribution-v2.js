/* RoboValley Contribution (v2): the owner's form, wired to the app API. Talks ONLY to window.RoboValleyApi.base with the visitor's own
   sign-in (credentials: include). Stores nothing in the browser. The app checks everything again, saves submissions as pending,
   checks duplicates and handles the review. */
( function () {
	'use strict';
	var root = document.getElementById( 'rv-c2' );
	if ( ! root || root.getAttribute( 'data-ready' ) ) {
		return;
	}
	root.setAttribute( 'data-ready', '1' );
	var api = String( ( window.RoboValleyApi && window.RoboValleyApi.base ) || '' ).replace( /\/+$/, '' );
	function $( s ) { return root.querySelector( s ); }
	var form = $( '#contribute' ), details = $( '#category-details' ), historyList = $( '#history' ), message = $( '#message' );
	var guest = $( '#guest' ), memberArea = $( '#member-area' ), sectorBox = $( '#sector-choices' ), photoBox = $( '#photos' ), photoFile = $( '#photo-file' );
	var choices = Array.prototype.slice.call( root.querySelectorAll( '#choices input' ) );
	// The limits: the owner's form is stricter for title and description (120 and 1,200); the server's minimums are 5 and 10.
	var L = { titleMin: 5, titleMax: 120, descMin: 10, descMax: 1200, folded: 2000, sectorsMax: 20, photosMax: 3, photoBytes: 4 * 1024 * 1024, altMax: 200, maxLinks: 5 };
	var TYPE = 'resource'; // the form has no type field; contributions are sent as "Share a video or resource"
	var me = null, draftId = null, busy = false, contactSaved = false, photos = [];
	var removedPhotos = [], wantSectors = null; // 0.1.5 Edit: saved photos the member removed; the saved sectors to tick once the list is loaded

	/* ---------- talking to the app ---------- */
	function call( method, path, body, isForm ) {
		var opts = { method: method, credentials: 'include', cache: 'no-store' };
		if ( body !== undefined ) {
			if ( isForm ) {
				opts.body = body;
			} else {
				opts.headers = { 'Content-Type': 'application/json' };
				opts.body = JSON.stringify( body );
			}
		}
		return fetch( api + path, opts ).then( function ( r ) {
			return r.json().catch( function () { return null; } ).then( function ( b ) {
				return { status: r.status, ok: r.ok && !! b && b.success !== false, body: b || {} };
			} );
		}, function () {
			return { status: 0, ok: false, body: { message: 'We could not reach RoboValley. Please check your connection and try again.' } };
		} );
	}
	function say( text ) {
		message.textContent = text;
		message.hidden = ! text;
	}

	/* ---------- signed in or not ---------- */
	function showGuest() {
		me = null;
		guest.hidden = false;
		memberArea.hidden = true;
	}
	/* Administrators and moderators review contributions and cannot send one (the app refuses with 403): a short note instead of the form */
	function showReviewer() {
		me = null;
		guest.hidden = true;
		memberArea.hidden = true;
		var note = document.createElement( 'p' ), link = document.createElement( 'a' ), out = document.createElement( 'button' );
		note.className = 'notice';
		note.id = 'rv-c2-reviewer';
		note.setAttribute( 'role', 'status' );
		note.appendChild( document.createTextNode( 'You are signed in to RoboValley as an administrator or moderator. Reviewers do not send contributions: sign in with a member account to contribute, or review contributions in ' ) );
		link.href = api + '/moderation';
		link.textContent = 'Moderation';
		note.appendChild( link );
		note.appendChild( document.createTextNode( '. ' ) );
		out.type = 'button';
		out.textContent = 'Sign Out';
		out.addEventListener( 'click', function () {
			call( 'POST', '/api/auth/logout' ).then( function () {
				note.parentNode.removeChild( note );
				showGuest();
				$( '#sign-in' ).focus();
			} );
		} );
		note.appendChild( out );
		guest.parentNode.insertBefore( note, guest );
	}
	function showMember( profile ) {
		me = profile;
		guest.hidden = true;
		memberArea.hidden = false;
		$( '#member-name' ).textContent = profile.firstName || 'Member';
		$( '#stakeholder' ).textContent = profile.stakeholder || ( profile.role === 'admin' ? 'Administrator' : 'Not set in your profile' );
		loadSectors();
		renderHistory();
	}
	/* After signing in, come back to this page, keeping ?sector= only when the app would accept it (else the app sends people home) */
	function back() {
		var page = location.origin + location.pathname, m = /[?&]sector=([a-z0-9,-]{1,700})(?:&|$)/.exec( location.search ), s;
		if ( ! m ) {
			return page;
		}
		s = m[ 1 ].split( ',' );
		return s.length <= 20 && s.every( function ( x, i ) { return x.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test( x ) && s.indexOf( x ) === i; } ) ? page + '?sector=' + m[ 1 ] : page;
	}
	$( '#sign-in' ).addEventListener( 'click', function () { location.href = api + '/login?returnTo=' + encodeURIComponent( back() ); } );
	$( '#sign-up' ).addEventListener( 'click', function () { location.href = api + '/join?returnTo=' + encodeURIComponent( back() ); } );
	$( '#sign-out' ).addEventListener( 'click', function () {
		call( 'POST', '/api/auth/logout' ).then( function () {
			resetContribution();
			say( '' );
			showGuest();
			$( '#sign-in' ).focus();
		} );
	} );

	/* ---------- sectors (from the app) ---------- */
	function loadSectors() {
		if ( sectorBox.getAttribute( 'data-loaded' ) ) {
			return;
		}
		call( 'GET', '/api/contributions/sectors' ).then( function ( r ) {
			var list = r.ok && Array.isArray( r.body.sectors ) ? r.body.sectors : [];
			sectorBox.textContent = '';
			if ( ! list.length ) {
				var s = document.createElement( 'small' );
				s.textContent = 'Sectors could not be loaded. Please reload the page.';
				sectorBox.appendChild( s );
				return;
			}
			sectorBox.setAttribute( 'data-loaded', '1' );
			list.forEach( function ( sec ) {
				var label = document.createElement( 'label' ), input = document.createElement( 'input' );
				input.type = 'checkbox';
				input.name = 'sector';
				input.value = sec.slug;
				label.appendChild( input );
				label.appendChild( document.createTextNode( sec.name ) );
				sectorBox.appendChild( label );
			} );
			preselectSectors();
			if ( wantSectors ) {
				tickSectors( wantSectors );
			}
		} );
	}
	/* "Contribute to this sector" links add ?sector=slug (or slug,slug): tick only sectors that really exist in the list, nothing else is read from the address */
	function preselectSectors() {
		var m = /[?&]sector=([a-z0-9,-]{1,700})(?:&|$)/.exec( location.search );
		if ( ! m ) {
			return;
		}
		m[ 1 ].split( ',' ).slice( 0, 20 ).forEach( function ( slug ) {
			var boxes = sectorBox.querySelectorAll( 'input[name="sector"]' ), i;
			for ( i = 0; i < boxes.length; i++ ) {
				if ( boxes[ i ].value === slug ) {
					boxes[ i ].checked = true;
				}
			}
		} );
	}

	/* ---------- My Contributions (from the app) ---------- */
	function renderHistory() {
		call( 'GET', '/api/contributions/mine' ).then( function ( r ) {
			historyList.textContent = '';
			var items = r.ok && Array.isArray( r.body.items ) ? r.body.items : [];
			$( '#empty' ).hidden = items.length > 0;
			items.forEach( function ( item ) {
				var row = document.createElement( 'li' ), status = document.createElement( 'span' );
				status.className = 'status';
				status.textContent = item.statusLabel || item.status;
				var sectors = ( item.sectors || [] ).map( function ( s ) { return s.name; } ).join( ', ' );
				row.appendChild( document.createTextNode( item.title + ( sectors ? ' · ' + sectors : '' ) + ' · ' ) );
				row.appendChild( status );
				/* 0.1.5: an item a moderator sent back for changes can be edited in this same form, then sent again */
				if ( item.status === 'changes_requested' ) {
					var edit = document.createElement( 'button' );
					edit.type = 'button';
					edit.className = 'rv-c2-edit';
					edit.textContent = 'Edit';
					edit.setAttribute( 'aria-label', 'Edit: ' + item.title );
					edit.addEventListener( 'click', function () { startEdit( item.id ); } );
					row.appendChild( document.createTextNode( ' ' ) );
					row.appendChild( edit );
				}
				if ( item.note && ( item.status === 'rejected' || item.status === 'removed' || item.status === 'changes_requested' ) ) {
					var note = document.createElement( 'div' );
					note.className = 'hint';
					note.textContent = item.note;
					row.appendChild( note );
				}
				/* replies from a moderator, whatever the status (0.1.4) */
				( Array.isArray( item.replies ) ? item.replies : [] ).forEach( function ( reply ) {
					var line = document.createElement( 'div' );
					line.className = 'hint';
					line.textContent = 'Reply from RoboValley: ' + String( reply && reply.message || '' );
					row.appendChild( line );
				} );
				historyList.appendChild( row );
			} );
		} );
	}

	/* ---------- the categories, as in the owner's form ---------- */
	var panels = choices.map( function ( choice ) {
		var panel = root.querySelector( '#category-template' ).content.firstElementChild.cloneNode( true );
		var links = panel.querySelector( '.references' ), add = panel.querySelector( '.add' );
		panel.querySelector( 'legend' ).textContent = choice.value;
		details.appendChild( panel );
		function updateCount() {
			panel.querySelector( '.count' ).textContent = links.childElementCount + ' of ' + L.maxLinks + ' links';
			add.disabled = links.childElementCount >= L.maxLinks;
		}
		choice.addEventListener( 'change', function () {
			choices[ 0 ].setCustomValidity( '' );
			panel.hidden = panel.disabled = ! choice.checked;
		} );
		add.addEventListener( 'click', function () {
			if ( links.childElementCount >= L.maxLinks ) {
				return;
			}
			var row = root.querySelector( '#reference-template' ).content.firstElementChild.cloneNode( true );
			row.querySelector( '.remove' ).addEventListener( 'click', function () {
				row.remove();
				updateCount();
				add.focus();
			} );
			links.appendChild( row );
			updateCount();
			row.querySelector( 'select' ).focus();
		} );
		return { choice: choice, panel: panel, links: links, updateCount: updateCount };
	} );

	/* ---------- photos: up to 3, JPG or PNG decided from the bytes, 4 MB, a description each ---------- */
	function photoCount() {
		$( '#photo-count' ).textContent = photos.length + ' of ' + L.photosMax + ' photos';
		photoFile.disabled = photos.length >= L.photosMax;
	}
	function kindOf( bytes ) {
		if ( bytes.length >= 8 && bytes[ 0 ] === 0x89 && bytes[ 1 ] === 0x50 && bytes[ 2 ] === 0x4e && bytes[ 3 ] === 0x47 && bytes[ 4 ] === 0x0d && bytes[ 5 ] === 0x0a && bytes[ 6 ] === 0x1a && bytes[ 7 ] === 0x0a ) {
			return 'image/png';
		}
		return bytes.length >= 3 && bytes[ 0 ] === 0xff && bytes[ 1 ] === 0xd8 && bytes[ 2 ] === 0xff ? 'image/jpeg' : null;
	}
	function photoError( text ) {
		photoFile.setCustomValidity( text );
		photoFile.reportValidity();
	}
	photoFile.addEventListener( 'change', function () {
		var file = photoFile.files && photoFile.files[ 0 ];
		photoFile.setCustomValidity( '' );
		if ( ! file ) {
			return;
		}
		if ( photos.length >= L.photosMax ) {
			photoFile.value = '';
			return photoError( 'You can add up to 3 photos.' );
		}
		if ( file.size > L.photoBytes ) {
			photoFile.value = '';
			return photoError( 'That photo is larger than 4 MB. Choose a smaller one.' );
		}
		file.slice( 0, 16 ).arrayBuffer().then( function ( buf ) {
			if ( ! kindOf( new Uint8Array( buf ) ) ) {
				photoFile.value = '';
				return photoError( 'Photos must be JPG or PNG.' );
			}
			var row = root.querySelector( '#photo-template' ).content.firstElementChild.cloneNode( true );
			var entry = { file: file, row: row, alt: row.querySelector( 'input' ), sent: false };
			row.querySelector( 'legend' ).textContent = 'Photo ' + ( photos.length + 1 ) + ' · ' + file.name;
			row.querySelector( '.remove' ).addEventListener( 'click', function () {
				photos.splice( photos.indexOf( entry ), 1 );
				row.remove();
				photoCount();
				photoFile.focus();
			} );
			photos.push( entry );
			photoBox.appendChild( row );
			photoFile.value = '';
			photoCount();
			entry.alt.focus();
		} );
	} );

	/* ---------- checking and sending ---------- */
	form.addEventListener( 'input', function () {
		Array.prototype.forEach.call( form.elements, function ( field ) {
			if ( field.validity && field.validity.customError ) {
				field.setCustomValidity( '' );
			}
		} );
	} );
	function invalid( field, text ) {
		field.setCustomValidity( text );
		field.reportValidity();
		return false;
	}
	function selectedSectors() {
		return Array.prototype.slice.call( root.querySelectorAll( '#sector-choices input:checked' ) ).map( function ( i ) { return i.value; } );
	}
	function oneLine( s ) { return String( s || '' ).replace( /\s+/g, ' ' ).trim(); }
	/** The categories, remarks and links are folded into the description text (no new database field). */
	function folded( selected ) {
		var lines = [ form.elements.description.value.trim(), '', 'Directory categories: ' + selected.map( function ( s ) { return s.choice.value; } ).join( ', ' ) ];
		selected.forEach( function ( s ) {
			var remarks = oneLine( s.panel.querySelector( '[name=remarks]' ).value );
			if ( remarks ) {
				lines.push( '[' + s.choice.value + '] Remarks: ' + remarks );
			}
			Array.prototype.forEach.call( s.links.children, function ( row, i ) {
				lines.push( '[' + s.choice.value + '] Link ' + ( i + 1 ) + ' (' + row.querySelector( 'select' ).value + '): ' + row.querySelector( '[name=referenceUrl]' ).value.trim() + ' - ' + oneLine( row.querySelector( '[name=referenceGist]' ).value ) );
			} );
		} );
		return lines.join( '\n' );
	}
	/** 0.1.5: the same categories, remarks and links as structured data (the folded text above is still sent too). */
	function directoryOf( selected ) {
		return selected.map( function ( s ) {
			return {
				category: s.choice.value,
				remarks: oneLine( s.panel.querySelector( '[name=remarks]' ).value ),
				links: Array.prototype.map.call( s.links.children, function ( row ) {
					return { type: row.querySelector( 'select' ).value, url: row.querySelector( '[name=referenceUrl]' ).value.trim(), gist: oneLine( row.querySelector( '[name=referenceGist]' ).value ) };
				} ),
			};
		} );
	}
	function contactFilled() {
		return !! ( form.elements.contactName.value.trim() || form.elements.contactEmail.value.trim() || form.elements.contactPhone.value.trim() );
	}
	function check() {
		var title = form.elements.title, desc = form.elements.description;
		if ( title.value.trim().length < L.titleMin ) {
			return invalid( title, 'Give it a title of at least 5 characters.' );
		}
		if ( desc.value.trim().length < L.descMin ) {
			return invalid( desc, 'Tell us a little more (at least 10 characters).' );
		}
		var selected = panels.filter( function ( p ) { return p.choice.checked; } );
		if ( ! selected.length ) {
			return invalid( choices[ 0 ], 'Select at least one directory category.' );
		}
		var rows = [];
		selected.forEach( function ( p ) { rows = rows.concat( Array.prototype.slice.call( p.links.children ) ); } );
		for ( var i = 0; i < rows.length; i++ ) {
			var type = rows[ i ].querySelector( 'select' ), url = rows[ i ].querySelector( '[name=referenceUrl]' ), gist = rows[ i ].querySelector( '[name=referenceGist]' );
			if ( ! type.value ) {
				return invalid( type, 'Please complete this field.' );
			}
			if ( ! /^https?:\/\//i.test( url.value.trim() ) ) {
				return invalid( url, 'Enter a link beginning with https:// or http://.' );
			}
			if ( ! gist.value.trim() ) {
				return invalid( gist, 'Please complete this field.' );
			}
		}
		var sectors = selectedSectors(), firstSector = root.querySelector( '#sector-choices input' );
		if ( ! sectors.length ) {
			return firstSector ? invalid( firstSector, 'Choose at least one sector.' ) : ( say( 'Sectors could not be loaded. Please reload the page.' ), false );
		}
		if ( sectors.length > L.sectorsMax ) {
			return invalid( firstSector, 'Too many sectors chosen.' );
		}
		for ( var p = 0; p < photos.length; p++ ) {
			if ( ! photos[ p ].alt.value.trim() ) {
				return invalid( photos[ p ].alt, 'Describe the photo in a few words (for people who cannot see it).' );
			}
		}
		if ( folded( selected ).length > L.folded ) {
			return invalid( desc, 'Your description, remarks and links are too long together (2000 characters at most). Please shorten them.' );
		}
		if ( contactFilled() ) {
			if ( ! form.elements.contactName.value.trim() ) {
				return invalid( form.elements.contactName, 'Tell us who to contact.' );
			}
			if ( ! form.elements.contactEmail.value.trim() && ! form.elements.contactPhone.value.trim() ) {
				return invalid( form.elements.contactEmail, 'Give an email address or a mobile number.' );
			}
		}
		return selected;
	}
	var FIELD = { title: 'title', description: 'description', name: 'contactName', email: 'contactEmail', phone: 'contactPhone' };
	function fail( res ) {
		busy = false;
		form.querySelector( 'button[type=submit]' ).disabled = false;
		var b = res.body || {};
		if ( res.status === 401 ) {
			showGuest();
			say( '' );
			return;
		}
		var saved = draftId ? ' Your draft is saved; fix this and press Submit for Review again.' : '';
		var fe = b.fieldErrors || {}, keys = Object.keys( fe );
		for ( var i = 0; i < keys.length; i++ ) {
			var k = keys[ i ], el = null;
			if ( FIELD[ k ] ) {
				el = form.elements[ FIELD[ k ] ];
			} else if ( k === 'sectors' ) {
				el = root.querySelector( '#sector-choices input' );
			} else if ( k === 'alt' || k === 'photo' ) {
				el = photoFile;
			}
			if ( el ) {
				el.setCustomValidity( fe[ k ] );
				el.reportValidity();
				break;
			}
		}
		var text = b.message || 'Something went wrong. Please try again.';
		if ( res.status === 429 ) {
			text = 'Lots of people are sending contributions right now. Please try again in a minute.';
		} else if ( res.status === 503 ) {
			text = 'Contributions are not open yet. Please try again later.';
		}
		say( text + saved );
	}
	form.addEventListener( 'submit', function ( event ) {
		event.preventDefault();
		if ( ! me || busy ) {
			return;
		}
		say( '' );
		var selected = check();
		if ( ! selected ) {
			return;
		}
		busy = true;
		form.querySelector( 'button[type=submit]' ).disabled = true;
		var payload = { type: TYPE, sectors: selectedSectors(), title: form.elements.title.value.trim(), description: folded( selected ), directory: directoryOf( selected ), robotType: '', role: me.stakeholder || '', district: '', website: form.elements.website.value };
		var first = draftId === null ? call( 'POST', '/api/contributions', payload ) : call( 'PATCH', '/api/contributions/' + draftId, payload );
		first.then( function ( r ) {
			if ( ! r.ok ) {
				return fail( r );
			}
			if ( r.body.id === 0 ) { // the bot trap was filled: nothing was stored; show the normal ending
				return done();
			}
			draftId = r.body.id || draftId;
			return removePhotos();
		} );
	} );
	function removePhotos() {
		if ( ! removedPhotos.length ) {
			return sendPhotos( 0 );
		}
		return call( 'DELETE', '/api/contributions/' + draftId + '/photos?photoId=' + encodeURIComponent( removedPhotos[ 0 ] ) ).then( function ( r ) {
			if ( ! r.ok && r.status !== 404 ) {
				return fail( r );
			}
			removedPhotos.shift();
			return removePhotos();
		} );
	}
	function sendPhotos( i ) {
		while ( i < photos.length && photos[ i ].sent ) {
			i++;
		}
		if ( i >= photos.length ) {
			return sendContact();
		}
		var data = new FormData();
		data.append( 'photo', photos[ i ].file );
		data.append( 'alt', oneLine( photos[ i ].alt.value ) );
		say( 'Uploading photo ' + ( i + 1 ) + '…' );
		return call( 'POST', '/api/contributions/' + draftId + '/photos', data, true ).then( function ( r ) {
			if ( ! r.ok ) {
				return fail( r );
			}
			photos[ i ].sent = true;
			return sendPhotos( i + 1 );
		} );
	}
	function sendContact() {
		var p;
		if ( contactFilled() ) {
			p = call( 'PUT', '/api/contributions/' + draftId + '/contact', { name: oneLine( form.elements.contactName.value ), email: form.elements.contactEmail.value.trim(), phone: form.elements.contactPhone.value.trim(), shareWithModerators: !! form.elements.shareWithModerators.checked } );
		} else if ( contactSaved ) {
			p = call( 'DELETE', '/api/contributions/' + draftId + '/contact' ).then( function () { return { ok: true }; } );
		} else {
			p = Promise.resolve( { ok: true } );
		}
		return p.then( function ( r ) {
			if ( ! r.ok ) {
				return fail( r );
			}
			contactSaved = contactFilled();
			return call( 'POST', '/api/contributions/' + draftId + '/submit' ).then( function ( s ) {
				return s.ok ? done() : fail( s );
			} );
		} );
	}
	function done() {
		busy = false;
		resetContribution();
		say( 'Thank you. Your contribution was sent for review. It stays pending and is not public until it is approved. See My Contributions below.' );
		renderHistory();
	}
	function resetContribution() {
		form.reset();
		draftId = null;
		contactSaved = false;
		form.querySelector( 'button[type=submit]' ).disabled = false;
		Array.prototype.forEach.call( form.elements, function ( field ) { if ( field.setCustomValidity ) { field.setCustomValidity( '' ); } } );
		panels.forEach( function ( p ) {
			p.panel.hidden = p.panel.disabled = true;
			p.links.textContent = '';
			p.updateCount();
		} );
		photos.forEach( function ( ph ) { ph.row.remove(); } );
		photos = [];
		photoCount();
		removedPhotos = [];
		wantSectors = null;
		var editing = root.querySelector( '#rv-c2-editing' );
		if ( editing ) {
			editing.parentNode.removeChild( editing );
		}
	}

	/* ---------- 0.1.5: Edit an item that needs changes (the same form, filled in) ---------- */
	function tickSectors( slugs ) {
		var boxes = sectorBox.querySelectorAll( 'input[name="sector"]' );
		wantSectors = slugs;
		if ( ! boxes.length ) {
			return; // the list is still loading: ticked when it arrives
		}
		Array.prototype.forEach.call( boxes, function ( b ) { b.checked = slugs.indexOf( b.value ) >= 0; } );
		wantSectors = null;
	}
	function addSavedPhoto( p ) {
		var row = root.querySelector( '#photo-template' ).content.firstElementChild.cloneNode( true );
		var entry = { file: null, row: row, alt: row.querySelector( 'input' ), sent: true, savedId: p.id };
		row.querySelector( 'legend' ).textContent = 'Photo ' + ( photos.length + 1 ) + ' · already saved';
		entry.alt.value = p.alt || '';
		entry.alt.readOnly = true; // a saved photo's description cannot change: remove it and add it again instead
		row.querySelector( '.remove' ).addEventListener( 'click', function () {
			removedPhotos.push( p.id );
			photos.splice( photos.indexOf( entry ), 1 );
			row.remove();
			photoCount();
			photoFile.focus();
		} );
		photos.push( entry );
		photoBox.appendChild( row );
	}
	function startEdit( id ) {
		if ( busy ) {
			return;
		}
		say( '' );
		call( 'GET', '/api/contributions/' + encodeURIComponent( id ) ).then( function ( r ) {
			var c = r.ok && r.body ? r.body.contribution : null;
			if ( ! c || c.status !== 'changes_requested' ) {
				say( ( r.body && r.body.message ) || 'This contribution cannot be edited right now.' );
				return;
			}
			resetContribution();
			draftId = c.id;
			form.elements.title.value = c.title || '';
			form.elements.description.value = c.description || '';
			( Array.isArray( c.directory ) ? c.directory : [] ).forEach( function ( d ) {
				var p = panels.filter( function ( x ) { return x.choice.value === d.category; } )[ 0 ];
				if ( ! p ) {
					return;
				}
				p.choice.checked = true;
				p.choice.dispatchEvent( new Event( 'change' ) );
				p.panel.querySelector( '[name=remarks]' ).value = d.remarks || '';
				( Array.isArray( d.links ) ? d.links : [] ).slice( 0, L.maxLinks ).forEach( function ( l ) {
					p.panel.querySelector( '.add' ).click();
					var row = p.links.lastElementChild;
					row.querySelector( 'select' ).value = l.type || '';
					row.querySelector( '[name=referenceUrl]' ).value = l.url || '';
					row.querySelector( '[name=referenceGist]' ).value = l.gist || '';
				} );
			} );
			tickSectors( Array.isArray( c.sectors ) ? c.sectors : [] );
			( Array.isArray( c.photos ) ? c.photos : [] ).slice( 0, L.photosMax ).forEach( addSavedPhoto );
			photoCount();
			if ( c.contact ) {
				form.elements.contactName.value = c.contact.name || '';
				form.elements.contactEmail.value = c.contact.email || '';
				form.elements.contactPhone.value = c.contact.phone || '';
				form.elements.shareWithModerators.checked = !! c.contact.shareWithModerators;
				contactSaved = true;
			}
			var note = document.createElement( 'p' ), cancel = document.createElement( 'button' );
			note.className = 'notice';
			note.id = 'rv-c2-editing';
			note.setAttribute( 'role', 'status' );
			note.appendChild( document.createTextNode( 'Editing “' + ( c.title || '' ) + '”: make the changes the moderator asked for, then press Submit for Review. ' ) );
			cancel.type = 'button';
			cancel.textContent = 'Cancel editing';
			cancel.addEventListener( 'click', function () {
				resetContribution();
				say( '' );
			} );
			note.appendChild( cancel );
			form.insertBefore( note, form.firstChild );
			form.elements.title.focus();
		} );
	}

	/* ---------- start ---------- */
	photoCount();
	if ( ! api ) {
		$( '#rv-c2-unavailable' ).hidden = false;
		return;
	}
	call( 'GET', '/api/auth/me' ).then( function ( r ) {
		if ( r.ok && r.body && r.body.role && r.body.reviewer === true ) {
			showReviewer();
		} else if ( r.ok && r.body && r.body.role ) {
			showMember( { firstName: r.body.firstName, role: r.body.role, stakeholder: r.body.stakeholder || '' } );
		} else if ( r.status === 0 ) {
			$( '#rv-c2-unavailable' ).hidden = false;
		} else {
			showGuest();
		}
	} );
}() );
