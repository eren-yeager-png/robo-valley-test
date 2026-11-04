<?php
foreach ( get_posts( array( 'post_type' => 'rv_project', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) ) as $i ) { wp_delete_post( $i, true ); }
foreach ( array( 'RVP CLICK TECH' ) as $n ) { $t = get_term_by( 'name', $n, 'rv_technology' ); if ( $t ) { wp_delete_term( $t->term_id, 'rv_technology' ); } }
echo "cleaned\n";
