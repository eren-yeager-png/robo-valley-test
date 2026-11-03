<?php
namespace Kubio\Ai;

class BlogContent {
	public static function generate_ipsum( $paragraphs = 6 ) {
		$faker = \Faker\Factory::create();
		// faker lorem
		return $faker->paragraphs( $paragraphs, true );
	}

	public static function save_articles_by_category( $articles = array(), $category_id = 0 ) {
		$posts = array();
		if ( ! empty( $articles ) ) {
			foreach ( $articles as $article ) {
				$content = self::generate_ipsum(
					wp_rand( 5, 8 )
				);

				$post_id = wp_insert_post(
					array(
						'post_title'   => $article['title'],
						'post_status'  => 'publish',
						'post_type'    => 'post',
						'post_content' => $content,
						'meta_input'   => array(
							'_kubio_created_post' => 1,
							'_kubio_post_image_keywords' => $article['imageKeywords'],
						),
					)
				);

				if ( ! is_wp_error( $post_id ) ) {
					wp_set_post_categories( $post_id, $category_id, false );
					$attach_id = PostImage::get_featured_image_from_keywords(
						$article['imageKeywords']
					);
					if ( is_int( $attach_id ) ) {
								set_post_thumbnail( $post_id, $attach_id );
					}

					$posts[] = $post_id;
				}
			}
		}
		return $posts;
	}
}
