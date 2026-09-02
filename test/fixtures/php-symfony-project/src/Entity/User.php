<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity]
class User
{
    #[ORM\Column(type: 'string', options: ['default' => ''])]
    #[Assert\NotBlank]
    public $email;

    public $plainProperty;
}
