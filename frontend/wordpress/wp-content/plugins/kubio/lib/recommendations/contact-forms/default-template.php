<div class="h-row">
	<div class="h-col h-col-12 h-col-md-6">
	<p>
		<label><?php esc_html_e( 'Name', 'kubio' ); ?> [text* your-name autocomplete:name] </label>
	</p>
	</div>
	<div class="h-col h-col-12 h-col-md-6">
	<p>
		<label><?php esc_html_e( 'Email', 'kubio' ); ?> [email* your-email autocomplete:email] </label>
	</p>
	</div>
</div>

<p>
	<label><?php esc_html_e( 'Subject', 'kubio' ); ?>  [text* your-subject] </label>
</p>

<p>
	<label><?php esc_html_e( 'Message', 'kubio' ); ?> [textarea* your-message 40x7] </label>
</p>

<p>[submit "<?php esc_html_e( 'Send message', 'kubio' ); ?>"]</p>
