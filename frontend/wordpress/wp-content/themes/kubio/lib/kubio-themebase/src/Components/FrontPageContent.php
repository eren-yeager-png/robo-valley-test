<?php


namespace Kubio\Theme\Components;

use ColibriWP\Theme\Components\FrontPageContent as ComponentsFrontPageContent;
use ColibriWP\Theme\Translations;

class FrontPageContent extends ComponentsFrontPageContent {


	protected static function getOptions() {
		return array(
			'panels' => array(
				'front_content_panel' => array(
					'priority'       => 2,
					'title'          => Translations::get( 'content_sections' ),
					'type'           => 'colibri_panel',

					'footer_buttons' => array(
						'change_header' => array(
							'label'   => Translations::get( 'add_section' ),
							'name'    => 'colibriwp_add_section',
							'classes' => array( 'colibri-button-large', 'button-primary' ),
							'icon'    => 'dashicons-plus-alt',
						),
					),
				),
			),
		);
	}


	public function renderContent( $parameters = array() ) {
		?>
		<div class="page-content" data-front-page="true">
		  <?php
			while ( have_posts() ) :
				the_post();
				?>
			<div id="content"  class="content">
				<?php
				the_content();
				endwhile;
			?>
			</div>
			<?php
			get_template_part( 'comments-page' );
			?>
		</div>
		  <?php

	}

}
